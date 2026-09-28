// A node's example: what its input.js gives one call, held to its output.js.
//
// A node that has definitions (`NodeRunner.definitions`) carries its own test:
// the example in its input definition is what one call is handed, and its
// output definition says what one call returns. ▶ Try runs the one, `test` and
// the MCP server's `test_graph` run all of them, and `run-node` runs one on
// its example when it is given nothing else -- the same function each time.
//
// A model's answer is never the same twice, so what is held is its shape, not
// its words: the keys the definition names, each in the form its example has.

import type { Graph } from '../graph.ts';
import type { Runtime } from '../elements/Runtime.ts';
import type { Runners } from '../elements/NodeRunner.ts';
import { definitionExample, misfits, unreadableOutput } from './definition.ts';
import { callNode } from '../execution/executor.ts';

/** How one node did on its example. */
export interface ExampleRun {
  /**
   * `pass`: it ran and what came out fits its output.js (or it has none to
   * fit); `fail`: it ran and does not fit -- or its output.js cannot be read;
   * `error`: it could not be run, or failed; `skipped`: it asks a model and
   * none was to be asked.
   */
  status: 'pass' | 'fail' | 'error' | 'skipped';
  /** Where it does not fit its output.js, or why it did not run. */
  details: string[];
  /** What one call returned. */
  outputs?: Record<string, unknown>;
  /**
   * Whether it was held to an output.js: a node without one only has to run,
   * and one whose output.js cannot be read is held to nothing -- it fails, and
   * its details say why.
   */
  held: boolean;
}

/** Whether an output definition is one a call can be held to: written, and readable. */
const holds = (output: string): boolean => !!output.trim() && !unreadableOutput(output);

/**
 * Run *nodeId* once on the example in its input.js -- on nothing, for a node
 * that takes nothing in -- and hold what comes out to its output.js.
 *
 * *offline*: nothing asks a model, and a node that would is skipped: how CI
 * runs it.
 */
export async function runExample(
  graph: Graph,
  nodeId: string,
  options: { runtime: Runtime; registry: Runners; offline?: boolean },
): Promise<ExampleRun> {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const element = node && options.registry.node(node.node_type);
  const definitions = node && element?.definitions(node);
  if (!node || !element || !definitions) {
    return { status: 'error', details: [node ? 'It has no example: only a code or an ai node has an input.js.' : `No node "${nodeId}".`], held: false };
  }
  const held = holds(definitions.output);
  let inputs: Record<string, unknown> = {};
  if (definitions.input.trim()) {
    const read = definitionExample(definitions.input);
    if ('problem' in read) return { status: 'error', details: [`Its input.js cannot be read: ${read.problem}.`], held };
    inputs = read.example;
  } else if (node.inputs.length) {
    return { status: 'error', details: ['It has no input.js, so there is nothing to try it on: write one with ✨ Input.'], held };
  }
  if (options.offline && element.asksModel(node)) {
    return { status: 'skipped', details: ['It asks a model, and this run asks none.'], held };
  }
  const ran = await callNode(graph, nodeId, inputs, { runtime: options.runtime, registry: options.registry });
  if (ran.status === 'error') return { status: 'error', details: [ran.error ?? 'It failed.'], outputs: ran.outputs, held };
  const details = misfits(ran.outputs, definitions.output);
  // A caught failure is on its error port, not in what it returns: it did not run through.
  if (ran.error) details.unshift(ran.error);
  return { status: details.length ? 'fail' : 'pass', details, outputs: ran.outputs, held };
}

/** The graph, and every graph its nodes hold, each with the way down to it (`outer ▸ `). */
export function everyGraphIn(graph: Graph, registry: Runners, inside = ''): { graph: Graph; inside: string }[] {
  return [
    { graph, inside },
    ...graph.nodes.flatMap((node) => {
      const held = registry.node(node.node_type)?.nestedGraph(node);
      return held ? everyGraphIn(held, registry, `${inside}${node.id} ▸ `) : [];
    }),
  ];
}

/** One node's example run, and the node, with the way down to it. */
interface TestedExample { inside: string; nodeId: string; result: ExampleRun }

/**
 * Run the example of every code and ai node -- or only of the nodes with the
 * id *only* -- at every depth, because the graph a node holds is part of the
 * same project, as `check` also says. One that takes something in and has no
 * input.js yet is said, skipped, rather than left out without a word. The one
 * runner behind `test` on the command line and `test_graph` over MCP.
 * `tested` counts the nodes it went through; none means nothing matched.
 */
export async function testGraph(
  graph: Graph,
  options: { runtime: () => Runtime; registry: Runners; offline?: boolean; only?: string },
): Promise<{ tested: number; results: TestedExample[] }> {
  const results: TestedExample[] = [];
  for (const { graph: level, inside } of everyGraphIn(graph, options.registry)) {
    const nodes = level.nodes.filter((node) => (options.only
      ? node.id === options.only
      : options.registry.node(node.node_type)?.definitions(node) !== undefined));
    for (const node of nodes) {
      const definitions = options.registry.node(node.node_type)?.definitions(node);
      const unwritten = !options.only && definitions && node.inputs.length && !definitions.input.trim();
      const result: ExampleRun = unwritten
        ? { status: 'skipped', details: ['It has no input.js yet, so there is nothing to try it on: write one with ✨ Input.'], held: holds(definitions.output) }
        : await runExample(level, node.id, { runtime: options.runtime(), registry: options.registry, offline: options.offline });
      results.push({ inside, nodeId: node.id, result });
    }
  }
  return { tested: results.length, results };
}
