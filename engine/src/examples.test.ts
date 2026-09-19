import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { Graph } from './graph.ts';
import { loadGraph } from './project/folder.ts';
import type { Trigger } from './execution/triggers.ts';
import { executeGraph, memoryFeedbackEdges, topologicalLevels } from './execution/executor.ts';
import { registry } from './elements/registry.ts';
import { nodeFiles, nodeCode } from './host/node.ts';
import { aiService } from './ai/providers.ts';
import { writeBundle } from './cli/bundle.ts';

/**
 * Every example, run the three ways a person runs one.
 *
 * **A click on Run** -- the whole graph, on nothing but its own defaults. An
 * example that needs a path typed in before it does anything is a puzzle, not
 * an example.
 *
 * **Its own page** -- where it has one: the event a block fires, and only what
 * that event is wired to.
 *
 * **Deployed** -- written as a bundle into a temporary folder and run *from
 * there*, with the repository out of reach. The files it starts on have to
 * have come along.
 *
 * The folder is read, not listed: an example added tomorrow is held to the
 * same three without anyone remembering to add it here.
 */

const REPO = resolve(__dirname, '..', '..');
const EXAMPLES = readdirSync(resolve(REPO, 'examples'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'data').map((entry) => entry.name).sort();

/** An endpoint that answers with a summary of what it was sent. */
function startModel(): Promise<{ url: string; server: Server; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      const user = parsed.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '';
      asked.push(String(user));
      // Derived from the prompt, so a change in how one is assembled shows up
      // as different text rather than passing unnoticed.
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { content: `summary(${String(user).length} chars)` } }],
      }));
    });
  });
  return new Promise((fulfil) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      fulfil({ url: `http://127.0.0.1:${port}/v1`, server, asked });
    });
  });
}

const model = await startModel();
afterAll(() => { model.server.close(); });

/**
 * An example as a graph in hand.
 *
 * Two things are changed, and neither is the graph. Its paths are made
 * absolute, because they are relative to the repository root and a test does
 * not run from there. And its model is swapped for the stub: these examples
 * name their provider on every node, and a test must not call it.
 */
async function load(name: string): Promise<Graph> {
  const graph = await loadGraph(resolve(REPO, 'examples', name));
  const rooted = (path: unknown) => (typeof path === 'string' && path && !isAbsolute(path) ? resolve(REPO, path) : path);
  for (const node of graph.nodes) {
    if (node.node_type === 'input' && node.config.input_mode !== 'text') node.config.value = rooted(node.config.value);
    for (const block of (node.config.gui_widgets as { kind: string; value: unknown }[] | undefined) ?? []) {
      if (block.kind === 'input_picker') block.value = rooted(block.value);
    }
    if (node.node_type === 'ai') { node.config.ai_provider = 'default'; node.config.ai_model = ''; }
  }
  graph.metadata.ai_defaults = { provider: 'default', model: '' };
  return graph;
}

function runGraph(graph: Graph, trigger: Trigger | null = null) {
  return executeGraph(graph, {
    registry,
    trigger,
    runtime: {
      files: nodeFiles,
      code: nodeCode,
      ai: aiService({ provider: 'openai_compatible', model: 'stub-model', endpoints: { openai_compatible: model.url } }),
    },
  });
}

type Result = Awaited<ReturnType<typeof runGraph>>;
const outputsOf = (result: Result, nodeId: string) => result.node_results.find((n) => n.node_id === nodeId)?.outputs ?? {};
const shownOn = (result: Result, nodeId: string) => result.node_results.find((n) => n.node_id === nodeId)?.display ?? {};
const blocksOf = (graph: Graph, nodeId: string) =>
  graph.nodes.find((n) => n.id === nodeId)!.config.gui_widgets as { id: string; value: unknown }[];

/** A bundle's own `run`, from its own folder, reaching the stub as "Google" -- the provider the examples name. */
function runBundle(dir: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((fulfil, fail) => {
    const child = spawn(process.execPath, [join(dir, 'engine', 'main.ts'), join(dir, 'graph.json'), '--limit', '1'], {
      cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GOOGLE_BASE_URL: model.url, GOOGLE_API_KEY: 'a-test-key',
        // This machine's own settings file must not decide what a test does.
        AI_GRAPH_SETTINGS: join(dir, 'no-settings-here.json'),
      },
    });
    let out = ''; let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', fail);
    child.on('close', (code) => fulfil({ code: code ?? -1, out, err }));
  });
}

describe.each(EXAMPLES)('%s', (name) => {
  it('is a graph the engine can order', async () => {
    const graph = await load(name);
    const feedback = memoryFeedbackEdges(graph.nodes, graph.edges, registry);
    expect(() => topologicalLevels(graph.nodes, graph.edges, feedback)).not.toThrow();
    expect(graph.metadata.description.length).toBeGreaterThan(20);
  });

  it('runs with a click on Run, on nothing but its own defaults', async () => {
    const result = await runGraph(await load(name));
    expect(result.node_results.filter((n) => n.status === 'error').map((n) => `${n.node_id}: ${n.error}`)).toEqual([]);
    expect(result.status).toBe('success');
  }, 120_000);

  it('can be deployed: it runs from its own folder, with the files it starts on', async () => {
    const graph = await loadGraph(resolve(REPO, 'examples', name));
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-example-'));
    try {
      await writeBundle(graph, dir, { dataFrom: REPO });
      const { code, out, err } = await runBundle(dir);
      expect(err).not.toMatch(/no such file|ENOENT/i);
      expect(code, err.slice(-1500)).toBe(0);
      expect(JSON.parse(out).status).toBe('success');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});

describe('what each example is there to show', () => {
  it('chat: a message starts the graph, and the turn is remembered', async () => {
    const before = model.asked.length;
    const graph = await load('chat');
    const chat = blocksOf(graph, 'page').find((block) => block.id === 'chat') as { value: { messages: unknown[]; pending: string } };
    const trigger = { node_id: 'page', port_id: 'chat_out' };

    chat.value.pending = 'Hello there';
    expect((await runGraph(graph, trigger)).status).toBe('success');
    chat.value.pending = 'And again';
    expect((await runGraph(graph, trigger)).status).toBe('success');

    // The second request carries the first turn: the block is the memory, and
    // the message template is what lays history and message out.
    const [first, second] = model.asked.slice(before);
    expect(first).toBe('Conversation so far:\n\n\nUser: Hello there');
    expect(second).toContain('User: Hello there\n\nAssistant: summary(');
    expect(second.endsWith('User: And again')).toBe(true);
    expect(chat.value.messages).toHaveLength(4);
    expect(chat.value.pending).toBe('');
  }, 60_000);

  it('chat: a click on Run with nothing typed asks nobody and changes nothing', async () => {
    const before = model.asked.length;
    const graph = await load('chat');
    const result = await runGraph(graph);
    expect(model.asked.length).toBe(before);
    expect(result.node_results.find((n) => n.node_id === 'assistant')?.status).toBe('skipped');
    expect((blocksOf(graph, 'page')[2].value as { messages: unknown[] }).messages).toEqual([]);
  }, 60_000);

  it('file_summarizer: changing the length redoes the summary, from the file as read', async () => {
    const before = model.asked.length;
    const result = await runGraph(await load('file_summarizer'), { node_id: 'page', port_id: 'length_out' });
    expect(result.node_results.map((n) => n.node_id).sort()).toEqual(['page', 'reader', 'summarizer']);
    expect(String(outputsOf(result, 'reader').info)).toMatch(/^01_the_lighthouse_keeper\.txt\n\d+ words/);

    const asked = model.asked.slice(before);
    expect(asked).toHaveLength(1);
    expect(asked[0].startsWith('Length of the summary: Three sentences\n\nThe text:\nThe Lighthouse')).toBe(true);
    expect(String(shownOn(result, 'page').summary)).toMatch(/^summary\(/);
  }, 60_000);

  it('folder_summaries: one call per story, one over all of them, and a row for each', async () => {
    const before = model.asked.length;
    const result = await runGraph(await load('folder_summaries'), { node_id: 'page', port_id: 'go_out' });
    const prompts = model.asked.slice(before);
    expect(prompts).toHaveLength(4);
    // The stories' text, not their filenames; and the last call gets the three
    // summaries as paragraphs rather than as a serialised list.
    expect(Math.max(...prompts.slice(0, 3).map((p) => p.length))).toBeGreaterThan(500);
    expect(prompts[3]).not.toContain('[');
    expect(prompts[3].split('\n\n')).toHaveLength(3);

    const rows = shownOn(result, 'page').table as { File: string; Summary: string }[];
    expect(rows.map((row) => row.File)).toEqual([
      '01_the_lighthouse_keeper.txt', '02_the_map_with_a_gap.txt', '03_the_second_key.txt',
    ]);
    expect(rows.every((row) => row.Summary.startsWith('summary('))).toBe(true);
  }, 120_000);

  it('population_plotter: every kind of chart is drawn, and reaches the page across the loop', async () => {
    for (const [kind, mark] of [['Horizontal bars', '<rect'], ['Columns', '<rect'], ['Donut', '<path']] as const) {
      const graph = await load('population_plotter');
      blocksOf(graph, 'page').find((block) => block.id === 'kind')!.value = kind;
      blocksOf(graph, 'page').find((block) => block.id === 'top')!.value = 6;

      const result = await runGraph(graph, { node_id: 'page', port_id: 'kind_out' });
      expect(result.status).toBe('success');
      // The chart fed back into the page that holds its controls: the memory
      // edge, settled and shown in the round that produced it.
      const drawing = String(shownOn(result, 'page').plot);
      expect(drawing.startsWith('<svg')).toBe(true);
      expect(drawing).toContain(mark);
      expect(drawing).toContain('top 6 of 20');
      expect((shownOn(result, 'page').table as { Country: string }[]).slice(0, 2).map((row) => row.Country)).toEqual(['India', 'China']);
    }
  }, 120_000);
});
