import { describe, it, expect, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { parseGraph } from './graph.ts';
import { executeGraph } from './executor.ts';
import { registry } from './registry.ts';
import { nodeFiles, nodeCode } from './host/node.ts';
import { aiService } from './ai/providers.ts';
import { applyRuntimeValues, runtimeRequirements, withDefaults } from './runtimeValues.ts';

/**
 * Every example, run and checked.
 *
 * This replaces the differential test, which ran each example through this
 * engine and through the Python one and diffed them. That test did its job —
 * six differences, two of them defects in the older engine — and its job ended
 * when the older engine did: there is nothing left to differ from.
 *
 * What must not end is the coverage. So the expectations that were implicit in
 * "both engines agree" are written out here: which nodes run, what they
 * produce, and the four behaviours that were hardest to get right — the memory
 * edge that makes a chart-into-panel loop legal, a wired file arriving as
 * content rather than a path, a per-item fan-out over a real folder, and a
 * prompt assembled from everything wired in.
 */

const REPO = resolve(__dirname, '..', '..');
process.env.AI_GRAPH_PYTHON ??= resolve(REPO, '.venv/Scripts/python.exe');

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

async function run(name: string, values: Record<string, string> = {}) {
  const graph = parseGraph(JSON.parse(await readFile(resolve(REPO, 'examples', name), 'utf8')));
  applyRuntimeValues(graph, withDefaults(runtimeRequirements(graph, registry), values), registry);
  return executeGraph(graph, {
    registry,
    runtime: {
      files: nodeFiles,
      code: nodeCode,
      ai: aiService({
        provider: 'openai_compatible',
        model: 'stub-model',
        endpoints: { openai_compatible: model.url },
      }),
    },
  });
}

const outputsOf = (result: Awaited<ReturnType<typeof run>>, nodeId: string) =>
  result.node_results.find((node) => node.node_id === nodeId)?.outputs ?? {};

describe('the examples run', () => {
  it('hello_world: a text input reaches the output', async () => {
    const result = await run('hello_world.json');
    expect(result.status).toBe('success');
    expect(outputsOf(result, 'greeting')).toEqual({ output: 'Hello, World!' });
  }, 60_000);

  it('plotter: a picked file becomes chart points, and the loop closes', async () => {
    const result = await run('plotter_interactive.json');
    expect(result.status).toBe('success');

    // The code node was handed the file's *content*, not its path, and turned
    // it into points. Wiring a file into a node that asked for content is what
    // `read_file_inputs` means.
    const points = outputsOf(result, 'points').points as { label: string; value: number }[];
    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toMatchObject({ label: expect.any(String), value: expect.any(Number) });

    // And the chart fed back into the panel that shows it — the memory edge,
    // settled in the round that produced it rather than the next one.
    const panel = result.node_results.find((node) => node.node_id === 'panel');
    expect(panel?.inputs.chart_in).toEqual(points);
  }, 120_000);

  it('bla_counter: a folder fans out per file and adds up', async () => {
    const result = await run('bla_counter.json', { folder: resolve(REPO, 'docs') });
    expect(result.status).toBe('success');

    // One run per file, kept as a list: the fan-out is the part that was
    // easiest to get subtly wrong, and an empty folder must produce none.
    const perFile = outputsOf(result, 'count_per_file').output as unknown[];
    expect(Array.isArray(perFile)).toBe(true);
    expect(perFile.length).toBeGreaterThan(1);

    const total = outputsOf(result, 'total');
    expect(total.summary).toMatch(/file\(s\)/);
  }, 120_000);

  it('text_summary: each story, then all of them', async () => {
    const before = model.asked.length;
    const result = await run('text_summary.json', {
      stories: resolve(REPO, 'examples/kurzgeschichten'),
    });
    expect(result.status).toBe('success');

    const each = outputsOf(result, 'per_story').output as string[];
    expect(each.length).toBe(3);

    // The prompts carried the stories' text — thousands of characters, not the
    // three filenames, which is what it sent before `read_file_inputs` moved to
    // the executor.
    const prompts = model.asked.slice(before);
    expect(prompts.length).toBe(4);
    expect(Math.max(...prompts.slice(0, 3).map((p) => p.length))).toBeGreaterThan(500);

    // The last call summarises the three summaries, and they arrive as
    // paragraphs rather than as a serialised list.
    expect(prompts[3]).not.toContain('[');
    expect(prompts[3].split('\n\n')).toHaveLength(3);
  }, 180_000);
});
