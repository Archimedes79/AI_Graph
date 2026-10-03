import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, type Served } from './serve.ts';

/**
 * The runtime API: a graph used by name, over HTTP, by any frontend -- the
 * routes a hand-written page calls, and nothing it would have to know about
 * the graph to call them.
 */

const port = (id: string, kind: 'input' | 'output') => ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '' });
const ECHO = {
  metadata: { name: 'Echo', description: 'Says what was picked.' },
  nodes: [
    {
      id: 'page', node_type: 'gui', config: {
        gui_widgets: [
          { id: 'pick', kind: 'select', label: 'Pick', options: 'a\nb', value: 'a', run_on_change: true },
          { id: 'shown', kind: 'text_io', mode: 'output', label: 'Shown' },
        ],
      },
    },
    { id: 'say', node_type: 'code', inputs: [port('pick', 'input')], outputs: [port('out', 'output')], config: { code: 'function run(i) { return { out: "picked " + i.pick }; }' } },
  ],
  edges: [
    { id: 'p', source_node_id: 'page', source_port_id: 'pick_out', target_node_id: 'say', target_port_id: 'pick' },
    { id: 's', source_node_id: 'say', source_port_id: 'out', target_node_id: 'page', target_port_id: 'shown_in' },
  ],
};

const served: Served[] = [];
afterAll(async () => { for (const one of served) await one.shutdown(); });

async function tool(): Promise<{ url: string; graphPath: string }> {
  const graphPath = join(await mkdtemp(join(tmpdir(), 'runtime-api-')), 'echo.json');
  await writeFile(graphPath, JSON.stringify(ECHO));
  const one = await serve({ graphPath, port: 0 });
  served.push(one);
  return { url: one.url, graphPath };
}

const get = async (url: string) => {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};
const post = async (url: string, body: unknown = {}) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

/** The events a stream sends, as they arrive, until *enough* says so. */
async function listen(url: string, enough: (events: { event: string; data: Record<string, unknown> }[]) => boolean, act: () => Promise<void>) {
  const stop = new AbortController();
  const response = await fetch(url, { signal: stop.signal });
  expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: { event: string; data: Record<string, unknown> }[] = [];
  let pending = '';
  let acted = false;
  try {
    while (!enough(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const blocks = pending.split('\n\n');
      pending = blocks.pop() ?? '';
      for (const block of blocks) {
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
      // Once it is open -- the session said once -- the round is asked for.
      if (!acted && events.length) {
        acted = true;
        await act();
      }
    }
  } finally {
    stop.abort();
  }
  return events;
}

describe('the runtime API', () => {
  it('says what the graph offers by name, and which session that is', async () => {
    const { url } = await tool();
    const { status, body } = await get(`${url}/api/runtime/interface`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      name: 'Echo',
      description: 'Says what was picked.',
      events: [{ name: 'pick' }],
      values: [{ name: 'pick', label: 'Pick', type: 'text' }],
      outputs: [{ name: 'shown', label: 'Shown' }],
    });
    expect(typeof body.session).toBe('string');
  });

  it('runs a round by event and values and answers once it ended: a function call', async () => {
    const { url, graphPath } = await tool();
    const { status, body } = await post(`${url}/api/runtime/run`, { event: 'pick', values: { pick: 'b' } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'success', error: null, outputs: { shown: 'picked b' }, values: { pick: 'b' } });
    // Kept in the session and beside the graph -- never in it.
    expect(existsSync(`${graphPath}.state.json`)).toBe(true);
    expect(JSON.parse(await readFile(graphPath, 'utf8')).nodes[0].config.gui_widgets[0].value).toBe('a');
    expect((await get(`${url}/api/runtime/session`)).body).toMatchObject({ values: { pick: 'b' }, outputs: { shown: 'picked b' }, rounds: 1 });
  }, 30_000);

  it('starts a round to be watched by its id, and stops one on request', async () => {
    const { url } = await tool();
    const started = await post(`${url}/api/runtime/rounds`, { event: 'pick', values: { pick: 'b' } });
    expect(started.status).toBe(200);
    const id = started.body.round_id as string;
    let round: Record<string, unknown> = {};
    for (let i = 0; i < 100; i += 1) {
      round = (await get(`${url}/api/runtime/rounds/${id}`)).body;
      if (round.done) break;
      await new Promise((wake) => setTimeout(wake, 100));
    }
    expect(round).toMatchObject({ round_id: id, done: true, outputs: { shown: 'picked b' } });
    expect((await post(`${url}/api/runtime/rounds/${id}/stop`)).body).toEqual({ stopped: true });
    expect((await get(`${url}/api/runtime/rounds/nothing`)).status).toBe(404);
  }, 30_000);

  it('turns down a name the graph does not offer, saying which it does', async () => {
    const { url } = await tool();
    const event = await post(`${url}/api/runtime/run`, { event: 'nothing' });
    expect(event.status).toBe(400);
    expect(event.body.detail).toMatch(/No event called "nothing": this graph starts on "pick"/);
    const value = await post(`${url}/api/runtime/rounds`, { values: { shown: 'typed into a display' } });
    expect(value.status).toBe(400);
    expect(value.body.detail).toMatch(/No value called "shown": this graph takes "pick"/);
  });

  it('answers for its own session only: another id is a frontend to send back to the interface', async () => {
    const { url } = await tool();
    const { body } = await get(`${url}/api/runtime/interface`);
    expect((await get(`${url}/api/runtime/session?session=${body.session as string}`)).status).toBe(200);
    const other = await get(`${url}/api/runtime/session?session=someone-else`);
    expect(other.status).toBe(404);
    expect(other.body.detail).toMatch(/No session "someone-else" here/);
  });

  it('forgets on reset what using the graph left behind', async () => {
    const { url, graphPath } = await tool();
    await post(`${url}/api/runtime/run`, { event: 'pick', values: { pick: 'b' } });
    const { status, body } = await post(`${url}/api/runtime/reset`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ values: { pick: 'a' }, outputs: {}, rounds: 0 });
    expect(existsSync(`${graphPath}.state.json`)).toBe(false);
  }, 30_000);

  it('streams the session on connect, then each round as it starts and ends, whoever started it', async () => {
    const { url } = await tool();
    const events = await listen(
      `${url}/api/runtime/stream`,
      (seen) => seen.some((one) => one.event === 'session' && one.data.rounds === 1) && seen.some((one) => one.event === 'round' && one.data.done === true),
      async () => { await post(`${url}/api/runtime/rounds`, { event: 'pick', values: { pick: 'b' } }); },
    );
    expect(events[0]).toMatchObject({ event: 'session', data: { values: { pick: 'a' }, rounds: 0 } });
    const rounds = events.filter((one) => one.event === 'round').map((one) => one.data);
    expect(rounds[0]).toMatchObject({ done: false });
    expect(rounds.at(-1)).toMatchObject({ done: true, outputs: { shown: 'picked b' } });
    expect(events.find((one) => one.event === 'session' && one.data.rounds === 1)?.data).toMatchObject({ values: { pick: 'b' }, outputs: { shown: 'picked b' } });
  }, 30_000);
});
