import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Graph, GraphNode } from '../graph.ts';
import type { Runtime } from '../elements/Runtime.ts';
import { RUN_PORT } from '../execution/triggers.ts';
import { edge, graphOf, quietRuntime } from '../../test/fakes.ts';
import { Session, type SessionOptions } from './session.ts';

/**
 * A graph in use, and what using it leaves behind: the rules of "State" in
 * docs/architecture.md, held one by one.
 *
 * Bodies run in this process, not the sandbox: what is tested is what a round
 * keeps, not how a body is run.
 */

function node(id: string, type = 'code', config: Record<string, unknown> = {}, ports: { in?: string[]; out?: string[] } = {}): GraphNode {
  const port = (name: string, kind: 'input' | 'output') => ({
    id: name, name, kind, data_type: 'any' as const, multi: false, required: false, description: '',
  });
  return {
    id, node_type: type as GraphNode['node_type'], label: id, description: '', position: { x: 0, y: 0 },
    config: type === 'code' ? { code: 'function run(inputs) { return inputs; }', ...config } : config,
    inputs: (ports.in ?? []).map((name) => port(name, 'input')),
    outputs: (ports.out ?? []).map((name) => port(name, 'output')),
  };
}

const inProcess: Runtime['code'] = {
  run: async (body, inputs, signal) => {
    // A body named "slow" waits for its Stop, as a model call that never answers would.
    if (body.includes('slow')) await new Promise((stopped) => signal?.addEventListener('abort', stopped));
    return new Function('inputs', `${body}; return run(inputs);`)(inputs) as Record<string, unknown>;
  },
};
const fake: SessionOptions['runtime'] = (report) => quietRuntime({ code: inProcess, report });
const open = (graph: Graph, file?: string) => Session.open(graph, { runtime: fake, file });
const wait = (ms: number) => new Promise((wake) => setTimeout(wake, ms));
const scratch = async () => join(await mkdtemp(join(tmpdir(), 'session-')), 'state.json');

/** A counter: a data node, and a code node adding one to what it holds, around a loop. */
function counter(add = 'function run(i) { return { next: i.n + 1 }; }'): Graph {
  return graphOf(
    [
      node('count', 'data', { data_format: 'structure', data_value: 0 }, { in: ['input'], out: ['output'] }),
      node('add', 'code', { code: add }, { in: ['n'], out: ['next'] }),
    ],
    [edge('n', 'count', 'output', 'add', 'n'), edge('next', 'add', 'next', 'count', 'input')],
  );
}

/** A page with a box that shows what a code node made of a dropdown's choice. */
function echo(): Graph {
  return graphOf(
    [
      node('page', 'gui', { gui_widgets: [
        { id: 'heading', kind: 'text', value: 'Echo' },
        { id: 'pick', kind: 'select', options: 'a\nb', value: 'a', run_on_change: true },
        { id: 'shown', kind: 'text_io', mode: 'output' },
      ] }),
      node('say', 'code', { code: 'function run(i) { return { out: "picked " + i.pick }; }' }, { in: ['pick'], out: ['out'] }),
    ],
    [edge('p', 'page', 'pick_out', 'say', 'pick'), edge('s', 'say', 'out', 'page', 'shown_in')],
  );
}

describe('a session', () => {
  it('keeps what a round leaves, and never in the design it was handed', async () => {
    const design = counter();
    const session = await open(design);
    await session.run(null);
    await session.run(null);
    expect(session.kept()).toEqual({ count: { data_value: 2 } });
    expect(design.nodes[0].config.data_value).toBe(0);
    expect(session.graph.nodes[0].config.data_value).toBe(0);
  });

  it('keeps a block that holds something by its id, and a heading not at all: that is its design', async () => {
    const session = await open(echo());
    const result = await session.run({ node_id: 'page', port_id: 'pick_out' });
    expect(result.status).toBe('success');
    expect(session.kept()).toEqual({ page: { shown: 'picked a' } });
  });

  it('empties a message once a round has delivered it, and keeps a setting', async () => {
    const page = node('page', 'gui', { gui_widgets: [
      { id: 'say', kind: 'text_io', mode: 'input', value: 'hello', run_on_change: true },
      { id: 'name', kind: 'text_io', mode: 'input', value: 'Ada' },
    ] });
    const graph = graphOf([page, node('heard', 'code', {}, { in: ['m', 'n'], out: ['m'] })],
      [edge('m', 'page', 'say_out', 'heard', 'm'), edge('n', 'page', 'name_out', 'heard', 'n')]);
    const session = await open(graph);
    const result = await session.run({ node_id: 'page', port_id: 'say_out' });
    expect(result.node_results.find((r) => r.node_id === 'heard')!.outputs).toEqual({ m: 'hello', n: 'Ada' });
    expect(session.kept()).toEqual({ page: { say: '' } });
  });

  it('commits nothing of a round that was stopped', async () => {
    const session = await open(counter());
    await session.run(null);
    session.hold(counter('function run(i) { slow; return { next: i.n + 1 }; }'));
    const { id } = session.start(null);
    await wait(30);
    session.stop(id);
    for (let i = 0; i < 50 && !session.snapshot(id)?.done; i += 1) await wait(10);
    expect(session.snapshot(id)).toMatchObject({ done: true, cancelled: true });
    expect(session.kept()).toEqual({ count: { data_value: 1 } });
  });

  it('commits nothing of a round that could not start, and says why', async () => {
    const loop = graphOf(
      [node('a', 'code', {}, { in: ['x'], out: ['y'] }), node('b', 'code', {}, { in: ['y'], out: ['x'] })],
      [edge('ab', 'a', 'y', 'b', 'y'), edge('ba', 'b', 'x', 'a', 'x')],
    );
    const session = await open(loop);
    await expect(session.run(null)).rejects.toThrow(/cycle/i);
    expect(session.kept()).toEqual({});
  });

  it('runs one round at a time, whoever asked: the second waits for the first', async () => {
    const session = await open(counter());
    const first = session.start(null);
    const second = session.start(null);
    expect(session.snapshot(second.id)).toMatchObject({ done: false, current_label: 'Waiting for the round before it' });
    for (let i = 0; i < 100 && !session.snapshot(second.id)?.done; i += 1) await wait(10);
    expect(session.snapshot(first.id)).toMatchObject({ done: true, total: 2 });
    // Each started from what the one before it left.
    expect(session.kept()).toEqual({ count: { data_value: 2 } });
  });
});

describe('what a session keeps on disk', () => {
  it('goes on after a restart, as the same session, from state.json', async () => {
    const file = await scratch();
    const first = await open(counter(), file);
    await first.run(null);
    await first.run(null);
    const kept = JSON.parse(await readFile(file, 'utf8'));
    expect(kept).toMatchObject({ session: first.id, graph: 't', rounds: 2, slots: { count: { data_value: { value: 2, default: 0 } } } });

    const second = await open(counter(), file);
    expect(second.id).toBe(first.id);
    expect(second.dropped).toEqual([]);
    await second.run(null);
    expect(second.kept()).toEqual({ count: { data_value: 3 } });
  });

  it('keeps no file for a graph that has no place for one', async () => {
    const session = await open(counter());
    await session.run(null);
    expect(session.kept()).toEqual({ count: { data_value: 1 } });
  });

  it('is emptied by a reset, file and all: the graph is as it was designed again', async () => {
    const file = await scratch();
    const session = await open(counter(), file);
    await session.run(null);
    expect(existsSync(file)).toBe(true);
    await session.reset();
    expect(existsSync(file)).toBe(false);
    expect(session.kept()).toEqual({});
    await session.run(null);
    expect(session.kept()).toEqual({ count: { data_value: 1 } });
  });

  it('waits for the round going before it resets, so that round cannot write over the reset', async () => {
    const session = await open(counter());
    session.start(null);
    await session.reset();
    expect(session.kept()).toEqual({});
  });

  it('starts with nothing kept from a file it cannot read, and says so', async () => {
    const file = await scratch();
    await writeFile(file, '{ not json');
    const session = await open(counter(), file);
    expect(session.kept()).toEqual({});
    expect(session.dropped).toEqual([expect.stringMatching(/could not be read/)]);
  });
});

describe('a design that changed', () => {
  it('drops what a node that is gone kept, and says so', async () => {
    const session = await open(counter());
    await session.run(null);
    const without = counter();
    without.nodes = without.nodes.filter((one) => one.id !== 'count');
    without.edges = [];
    expect(session.hold(without)).toEqual(['What "count" kept was dropped: it is no longer in the graph.']);
    expect(session.kept()).toEqual({});
  });

  it('treats a renamed node as one gone and one new: nothing is guessed', async () => {
    const session = await open(counter());
    await session.run(null);
    const renamed = counter();
    renamed.nodes[0].id = 'tally';
    renamed.edges = [edge('n', 'tally', 'output', 'add', 'n'), edge('next', 'add', 'next', 'tally', 'input')];
    expect(session.hold(renamed)).toEqual(['What "count" kept was dropped: it is no longer in the graph.']);
    await session.run(null);
    expect(session.kept()).toEqual({ tally: { data_value: 1 } });
  });

  it('drops what a block that is gone held', async () => {
    const session = await open(echo());
    await session.run({ node_id: 'page', port_id: 'pick_out' });
    const without = echo();
    without.nodes[0].config.gui_widgets = (without.nodes[0].config.gui_widgets as { id: string }[]).filter((block) => block.id !== 'shown');
    without.edges = without.edges.filter((wire) => wire.target_port_id !== 'shown_in');
    expect(session.hold(without)).toEqual(['What "page" kept in "shown" was dropped: "shown" is no longer there.']);
  });

  it('wins over what was kept: a slot whose design changed starts from the design again', async () => {
    const file = await scratch();
    const session = await open(counter(), file);
    await session.run(null);
    const restarted = counter();
    restarted.nodes[0].config.data_value = 10;
    expect(session.hold(restarted)).toEqual(['What "count" kept in "data_value" was dropped: its design changed.']);
    await session.run(null);
    expect(session.kept()).toEqual({ count: { data_value: 11 } });

    // The same is said when the design changed while the tool was not running.
    const reopened = await open(counter(), file);
    expect(reopened.dropped).toEqual(['What "count" kept in "data_value" was dropped: its design changed.']);
  });

  it('keeps what a design that changed elsewhere has no quarrel with', async () => {
    const session = await open(counter());
    await session.run(null);
    const relabelled = counter();
    relabelled.nodes[1].label = 'Add one';
    expect(session.hold(relabelled)).toEqual([]);
    expect(session.kept()).toEqual({ count: { data_value: 1 } });
  });
});

/**
 * The ◆ through a session: the rounds of `execution/gates.test.ts`, each a
 * round of one session rather than a run handed one latch. A round's latch is
 * committed when it ends; these hold that a gate behaves as it did.
 */
describe('a gate, round by round', () => {
  function reader(length = 'short'): Graph {
    return graphOf(
      [
        node('page', 'gui', { gui_widgets: [
          { id: 'read', kind: 'button', label: 'Read' },
          { id: 'length', kind: 'select', options: 'short\nlong', value: length, run_on_change: true },
          { id: 'shown', kind: 'text_io', mode: 'output' },
        ] }),
        node('reader', 'code', { code: 'function run() { return { text: "the file" }; }' }, { out: ['text'] }),
        node('summary', 'code', { code: 'function run(i) { return { out: i.length + ": " + i.text }; }' }, { in: ['text', 'length'], out: ['out'] }),
      ],
      [
        edge('gate', 'page', 'read_out', 'reader', RUN_PORT),
        edge('text', 'reader', 'text', 'summary', 'text'),
        edge('len', 'page', 'length_out', 'summary', 'length'),
        edge('show', 'summary', 'out', 'page', 'shown_in'),
      ],
    );
  }
  const READ = { node_id: 'page', port_id: 'read_out' };
  const LENGTH = { node_id: 'page', port_id: 'length_out' };

  it('stays shut for another event, and what the node made in an earlier round stands', async () => {
    const session = await open(reader());
    await session.run(READ);
    session.hold(reader('long'));
    const run = await session.run(LENGTH);
    expect(run.node_results.find((r) => r.node_id === 'reader')).toMatchObject({ status: 'skipped', held: true, outputs: { text: 'the file' } });
    expect(session.kept()).toEqual({ page: { shown: 'long: the file' } });
  });

  it('holds nothing a stopped round made', async () => {
    const session = await open(reader());
    const slow = reader();
    slow.nodes[1].config.code = 'function run() { slow; return { text: "the file" }; }';
    session.hold(slow);
    const { id } = session.start(READ);
    await wait(30);
    session.stop(id);
    for (let i = 0; i < 50 && !session.snapshot(id)?.done; i += 1) await wait(10);
    session.hold(reader());
    const run = await session.run(LENGTH);
    expect(run.node_results.find((r) => r.node_id === 'reader')).toMatchObject({ status: 'skipped', outputs: {} });
    expect(run.node_results.find((r) => r.node_id === 'reader')!.held).toBeUndefined();
  });

  it('is remembered across a restart', async () => {
    const file = await scratch();
    const first = await open(reader(), file);
    await first.run(READ);
    const second = await open(reader('long'), file);
    const run = await second.run(LENGTH);
    expect(run.node_results.find((r) => r.node_id === 'reader')).toMatchObject({ held: true, outputs: { text: 'the file' } });
    expect(run.node_results.find((r) => r.node_id === 'summary')).toMatchObject({ outputs: { out: 'long: the file' } });
  });

  it('remembers a data node across rounds though settling changes its config', async () => {
    const graph = graphOf(
      [
        node('page', 'gui', { gui_widgets: [
          { id: 'read', kind: 'button' },
          { id: 'length', kind: 'select', options: 'short\nlong', value: 'short', run_on_change: true },
        ] }),
        node('reader', 'code', { code: 'function run() { return { text: "the file" }; }' }, { out: ['text'] }),
        node('keep', 'data', { data_value: '' }, { in: ['input'], out: ['output'] }),
        node('summary', 'code', { code: 'function run(i) { return { out: i.length + ": " + i.text }; }' }, { in: ['text', 'length'], out: ['out'] }),
      ],
      [
        edge('gate', 'page', 'read_out', 'reader', RUN_PORT),
        edge('a', 'reader', 'text', 'keep', 'input'),
        edge('b', 'keep', 'output', 'summary', 'text'),
        edge('c', 'page', 'length_out', 'summary', 'length'),
      ],
    );
    const session = await open(graph);
    await session.run(READ);
    const second = await session.run(LENGTH);
    expect(second.node_results.find((r) => r.node_id === 'reader')).toMatchObject({ held: true });
    expect(second.node_results.find((r) => r.node_id === 'summary')).toMatchObject({ status: 'success', outputs: { out: 'short: the file' } });
  });
});
