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
import { Latch } from './execution/latch.ts';
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

function runGraph(graph: Graph, trigger: Trigger | null = null, latch?: Latch) {
  return executeGraph(graph, {
    registry,
    trigger,
    latch,
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
  it('nested_statistics: the part runs inside the whole, and on its own', async () => {
    const whole = await runGraph(await load('nested_statistics'));
    expect(whole.status).toBe('success');
    // The value came up through the node that holds the graph doing the counting.
    expect(whole.outputs.Statistics).toEqual({ value: { words: 32, sentences: 2, longest: 'directions' } });

    // And the same folder is a project: the graph inside runs by itself, on the
    // value its own input node holds. That is the claim the design rests on.
    const alone = await runGraph(await loadGraph(resolve(REPO, 'examples/nested_statistics/nodes/statistics')));
    expect(alone.status).toBe('success');
    expect(alone.outputs.Numbers).toEqual({ value: { words: 8, sentences: 1, longest: 'sentence' } });
  });

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
    expect((blocksOf(graph, 'page').find((block) => block.id === 'chat')!.value as { messages: unknown[] }).messages).toEqual([]);
  }, 60_000);

  it('file_summarizer: before anything was read, a change of length has nothing to summarize', async () => {
    const before = model.asked.length;
    const result = await runGraph(await load('file_summarizer'), { node_id: 'page', port_id: 'length_out' }, new Latch());
    expect(model.asked.length).toBe(before);
    expect(result.status).toBe('success');
    expect(result.node_results.find((n) => n.node_id === 'summarizer')?.status).toBe('skipped');
  }, 60_000);

  it('file_summarizer: changing the length redoes the summary, from the file as it was read', async () => {
    // The reader's ◆ hangs on the button, so a change of length does not read
    // the file again: what the reader made in the round before stands.
    const latch = new Latch();
    await runGraph(await load('file_summarizer'), { node_id: 'page', port_id: 'go_out' }, latch);
    const before = model.asked.length;
    const result = await runGraph(await load('file_summarizer'), { node_id: 'page', port_id: 'length_out' }, latch);
    expect(result.node_results.map((n) => n.node_id).sort()).toEqual(['page', 'reader', 'summarizer']);
    expect(result.node_results.find((n) => n.node_id === 'reader')).toMatchObject({ status: 'skipped', held: true });
    expect(String(outputsOf(result, 'reader').info)).toMatch(/^01_the_lighthouse_keeper\.txt\n\d+ words/);

    const asked = model.asked.slice(before);
    expect(asked).toHaveLength(1);
    expect(asked[0].startsWith('Length of the summary: Three sentences\n\nThe text:\nThe Lighthouse')).toBe(true);
    expect(String(shownOn(result, 'page').summary)).toMatch(/^summary\(/);
  }, 60_000);

  it('folder_summaries: choosing a folder asks once per file, with the file\'s text, and the page shows the summaries', async () => {
    const before = model.asked.length;
    const result = await runGraph(await load('folder_summaries'), { node_id: 'page', port_id: 'folder_out' });
    expect(result.status).toBe('success');
    const prompts = model.asked.slice(before);
    expect(prompts).toHaveLength(3);
    // The stories' text, not their filenames.
    expect(Math.min(...prompts.map((prompt) => prompt.length))).toBeGreaterThan(500);
    // One summary per file reaches the one window, across the loop, in the round that made them.
    const shown = shownOn(result, 'page').summaries;
    const summaries = Array.isArray(shown) ? shown : String(shown).split('\n').filter(Boolean);
    expect(summaries).toHaveLength(3);
    expect(summaries.every((summary) => String(summary).startsWith('summary('))).toBe(true);
  }, 120_000);

  /**
   * What the node is responsible for, and nothing more: it says *what* to plot
   * and the chart block draws it, so what is checked here is the figure.
   * Nothing in a run knows how big the chart will be.
   */
  it('population_plotter: choosing a file is all it takes -- the figure reaches the page across the loop', async () => {
    const graph = await load('population_plotter');
    const result = await runGraph(graph, { node_id: 'page', port_id: 'file_out' });
    expect(result.status).toBe('success');
    const figure = shownOn(result, 'page').plot as { kind: string; title: string; points: { label: string; value: number }[] };
    expect(figure).toMatchObject({ kind: 'bars', title: 'Population by Country' });
    expect(figure.points).toHaveLength(20);
    expect(figure.points.slice(0, 2).map((point) => point.label)).toEqual(['India', 'China']);
  }, 120_000);

  it('population_plotter: with no file chosen the chart says so, instead of the run failing', async () => {
    const graph = await load('population_plotter');
    blocksOf(graph, 'page').find((block) => block.id === 'file')!.value = '';
    const result = await runGraph(graph);
    expect(result.status).toBe('success');
    expect(shownOn(result, 'page').plot).toMatchObject({ title: 'Choose a CSV file to plot.', points: [] });
  }, 120_000);
});
