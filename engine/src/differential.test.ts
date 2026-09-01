import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseGraph } from './graph.js';
import { executeGraph } from './executor.js';
import { registry } from './registry.js';
import { applyRuntimeValues, runtimeRequirements, withDefaults } from './runtimeValues.js';
import { nodeRuntime } from './host/node.js';

/**
 * The same graph through both engines, compared.
 *
 * This is the test the port exists to pass. Reasoning about whether a
 * TypeScript executor "does the same thing" as a Python one is guesswork;
 * running a real example through both and diffing what every node produced is
 * not. It covers the parts that are easy to get subtly wrong — the ordering,
 * the memory edge that makes a chart-into-panel loop legal, reading a wired
 * file into text, and handing a body its inputs as plain JSON.
 *
 * The Python side runs through `graph-runner/run.py`, which is what a deploy
 * bundle runs, so this compares the new engine against the thing people
 * actually have rather than against a test harness.
 */

const REPO = resolve(__dirname, '../..');

// The interpreter this repo's Python engine uses, so both sides run the same one.
// Without it the engine probes PATH, where Windows offers a Store stub that
// prints an advert instead of running the body.
process.env.AI_GRAPH_PYTHON ??= resolve(REPO, '.venv/Scripts/python.exe');

function runPython(graphPath: string, values: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const inputs = Object.entries(values).flatMap(([key, value]) => ['--inputs', `${key}=${value}`]);
  return new Promise((fulfil, fail) => {
    const child = spawn(
      resolve(REPO, '.venv/Scripts/python.exe'),
      [resolve(REPO, 'graph-runner/run.py'), graphPath, ...inputs],
      // No stdin: a graph that prompts should fall back to its stored default
      // rather than wait for a person who is not there.
      { cwd: REPO, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) return fail(new Error(`run.py exited ${code}:\n${err}`));
      try {
        fulfil(JSON.parse(out));
      } catch {
        fail(new Error(`run.py printed no JSON:\n${out.slice(0, 400)}`));
      }
    });
  });
}

async function runTypeScript(graphPath: string, values: Record<string, string> = {}) {
  const graph = parseGraph(JSON.parse(await readFile(graphPath, 'utf8')));
  // The same answers the Python side is given, through the same two steps: ask
  // the elements what is missing, then let each store what it was told.
  applyRuntimeValues(graph, withDefaults(runtimeRequirements(graph, registry), values), registry);
  return executeGraph(graph, { runtime: nodeRuntime(), registry });
}

/** Outputs per node, which is what "the same run" means. */
function outputsByNode(result: any): Record<string, unknown> {
  const byNode: Record<string, unknown> = {};
  for (const node of result.node_results ?? []) byNode[node.node_id] = node.outputs;
  return byNode;
}

// The examples both engines can run today, with the answers a person would
// give. The two AI ones are missing on purpose: they need a model provider on
// the TypeScript side, and that is the next piece.
// docs/ rather than examples/kurzgeschichten: the counter is set to read
// .md files and the stories are .txt, so pointing it at them fans out over
// nothing and the per-item batching -- the part most likely to differ -- would
// never run at all.
const MARKDOWN = resolve(REPO, 'docs');
const EXAMPLES: [string, Record<string, string>][] = [
  ['hello_world.json', {}],
  ['bla_counter.json', { folder: MARKDOWN }],
  ['plotter_interactive.json', {}],
];

describe('the two engines agree', () => {
  const graphPath = resolve(REPO, 'examples/plotter_interactive.json');

  it.each(EXAMPLES)('produce the same outputs for %s', async (name, values) => {
    const path = resolve(REPO, 'examples', name);
    const [python, typescript] = await Promise.all([
      runPython(path, values), runTypeScript(path, values),
    ]);
    expect(typescript.status).toBe((python as any).status);
    expect(outputsByNode(typescript)).toEqual(outputsByNode(python));
  }, 180_000);

  it('produce the same outputs for the plotter example', async () => {
    const [python, typescript] = await Promise.all([runPython(graphPath), runTypeScript(graphPath)]);

    expect((python as any).status).toBe('success');
    expect(typescript.status).toBe('success');
    expect(outputsByNode(typescript)).toEqual(outputsByNode(python));
  }, 120_000);

  it('really fans a batch out, rather than agreeing about nothing', async () => {
    // Two engines can agree because both did nothing. The counter is per-item
    // over a folder, so this checks the fan-out actually happened -- otherwise
    // the batching contract, which is where they differed first, goes untested.
    const path = resolve(REPO, 'examples/bla_counter.json');
    const result = await runTypeScript(path, { folder: resolve(REPO, 'docs') });
    const perFile = result.node_results.find((n) => n.node_id === 'count_per_file');
    expect(Array.isArray(perFile?.outputs.output)).toBe(true);
    expect((perFile?.outputs.output as unknown[]).length).toBeGreaterThan(1);
  }, 180_000);

  it('agrees about the loop the interface closes', async () => {
    // The chart feeds back into the panel that shows it. Both engines must
    // treat that edge as memory -- left out of the ordering, settled after --
    // rather than calling the graph cyclic.
    const result = await runTypeScript(graphPath);
    const panel = result.node_results.find((n) => n.node_id === 'panel');
    expect(panel?.status).toBe('success');
    // Settled for the round it was produced in, not the next one.
    expect(Array.isArray(panel?.inputs.chart_in)).toBe(true);
  }, 120_000);
});
