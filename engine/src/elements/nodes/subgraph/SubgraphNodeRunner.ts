import { NodeRunner } from '../../NodeRunner.ts';
import type { TextFile, WhatRuns } from '../../ElementRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { parseGraph, type ExecutionResult, type Graph, type GraphNode } from '../../../graph.ts';
import { port } from '../../port.ts';
import type { Problem } from '../../../execution/wiring.ts';
import { boundaryInputs, boundaryOutputs, boundaryPorts, carried, handedUp, type Runners } from './boundary.ts';

export interface SubgraphConfig {
  /** The graph this node holds. An empty one for a node nobody has filled in yet. */
  graph: Graph | null;
  /** What it is meant to do, for a person and for the day an AI fills it in. */
  task: string;
}

/** What this keeps in files of its own in a project folder: see `ElementRunner.texts`. */
const SUBGRAPH_TEXTS: readonly TextFile[] = [
  { field: 'task', file: 'task.md' },
];

/**
 * A node that holds a graph.
 *
 * **A subgraph is an ordinary graph**, and almost nothing here exists to make
 * that true -- the same `executeGraph` runs it, the same project folder stores
 * it, the same `check` checks it, the same editor edits it. What is left for
 * this file is one node's own contract: the dictionary at the boundary
 * (`boundary.ts`), what may stand at it (`problems`), and handing the values
 * across (`execute`).
 *
 * Three consequences worth stating, because all three are asked about:
 *
 * - An input node inside that nothing is wired to still uses its own value.
 *   That is not a special case for subgraphs; it is what an input node with
 *   nothing wired into it has always done.
 * - The graph inside can be run, checked and deployed on its own -- its folder
 *   is a project folder like any other. A subgraph that only works while
 *   enclosed would be a second kind of graph, and there is only one kind.
 * - Anything short of a clean run in there fails this node. From out here it
 *   is one node, and half of it having worked is not something a port can
 *   carry; `execute` says why at more length.
 */
export class SubgraphNodeRunner extends NodeRunner<SubgraphConfig> {
  readonly nodeType = 'subgraph' as const;

  override texts(): readonly TextFile[] {
    return SUBGRAPH_TEXTS;
  }

  config(node: GraphNode): SubgraphConfig {
    return { graph: readGraph(node.config.subgraph), task: String(node.config.task ?? '') };
  }

  /**
   * A copy, always. The executor may run this node several times at once (a
   * per-item fan-out is one node object and many calls), and a run that
   * settled memory or answered an input node inside a shared graph would be
   * two runs writing over each other -- and would write into what the editor
   * holds and the folder saves, besides.
   */
  override nestedGraph(node: GraphNode): Graph | null {
    const stored = node.config.subgraph;
    // Nothing stored is an empty graph, not "no graph": this node holds one
    // either way, and its folder is where it is kept -- which is how a save
    // knows to write it, and a read knows to look.
    if (stored === undefined || stored === null || stored === '') return parseGraph({ nodes: [], edges: [] });
    return readGraph(stored);
  }

  override setNestedGraph(node: GraphNode, graph: Graph | null): void {
    if (graph) node.config.subgraph = graph;
    else delete node.config.subgraph;
  }

  override derivedPorts(node: GraphNode, elements: Runners) {
    const graph = this.nestedGraph(node);
    // Not readable as a graph: no ports rather than an exception. `check` is
    // where an unreadable graph is reported; a node drawn on a canvas is not.
    if (!graph) return { inputs: [], outputs: [] };
    const ports = boundaryPorts(graph, elements);
    if (!this.catchesErrors(node)) return ports;
    return {
      inputs: ports.inputs,
      outputs: [...ports.outputs, port('error', 'Error', 'output', 'text', false, 'Set when the graph inside failed')],
    };
  }

  /** A path that arrives here is a path: what to do with it is the inner graph's business. */
  override readsFileInputs(): boolean {
    return false;
  }

  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const graph = this.nestedGraph(node);
    if (!graph) throw new Error('This node holds no graph that can be read.');
    if (!runtime.subgraph) throw new Error('A graph inside a node can only be run by the engine that runs graphs.');
    const elements = runtime.subgraph.elements;

    // The graph this node sits in has already had its AI default applied to
    // the runtime; the inner graph's own default would otherwise override it
    // from below, which is backwards -- a graph pasted in as a subgraph should
    // follow the tool it became part of.
    graph.metadata.ai_defaults = { provider: 'default', model: '' };

    const given: Record<string, Record<string, unknown>> = {};
    for (const boundary of boundaryInputs(graph, elements)) {
      // A port nothing is wired to is not answered, and the node inside runs
      // as it is configured.
      if (!(boundary.id in inputs)) continue;
      given[boundary.id] = { output: inputs[boundary.id] };
    }

    const run = await runtime.subgraph.run(graph, given);
    // Anything short of a clean run inside is this node's failure.
    //
    // From out here this is one node, and "half of it worked" is not something
    // a port can carry: what it would carry is a null nobody can explain,
    // while the reason stays in a report nobody is looking at. A `partial` run
    // counts -- an item of a fan-out that failed, a node that caught its own
    // failure and passed nothing on. To let the graph above carry on anyway,
    // tick this node's own catch-errors: then the reason arrives on its error
    // port, which is the one place a caught failure belongs.
    if (run.status !== 'success') {
      throw new Error(`Inside "${node.label || node.id}": ${trouble(run)}`);
    }

    const produced: Record<string, unknown> = {};
    for (const boundary of boundaryOutputs(graph, elements)) {
      const arrived = run.node_results.find((result) => result.node_id === boundary.id)?.inputs ?? {};
      produced[boundary.id] = handedUp(boundary, arrived, elements);
    }
    return produced;
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override whatRuns(): WhatRuns {
    return this.engineRuns('Runs the graph in its folder, whole, with what arrives standing in for its input nodes, and hands on what reaches its output nodes.');
  }

  /**
   * What this node's own contract says about the graph it holds.
   *
   * The boundary is this element's idea, so the rules about it live here
   * rather than in the project checker. `check` walks into the graph and
   * checks it as a graph, which is the other half and none of this file's
   * business.
   */
  override problems(node: GraphNode, elements: Runners, where: string): Problem[] {
    const held = this.nestedGraph(node);
    if (!held) {
      return [{
        where,
        problem: 'The graph this node holds cannot be read.',
        fix: 'Open its folder and fix its graph.json, or delete the node and build it again.',
      }];
    }

    const found: Problem[] = [];
    const inside = `${where} ▸ `;
    if (!held.nodes.length && this.config(node).task.trim()) {
      found.push({
        where,
        problem: 'This part is described and empty: it says what it should do and does nothing.',
        fix: 'Open it and build the graph inside, or delete the node if the plan has changed.',
      });
    }

    for (const inner of held.nodes) {
      if (!elements.node(inner.node_type)?.keepsTime(inner)) continue;
      found.push({
        where: `${inside}${inner.label || inner.id}`,
        problem: 'A clock inside a graph that a node holds never ticks: only the outermost graph is held by something that keeps time.',
        fix: 'Put the trigger in the outer graph and wire it to this node\'s ◆; or give the inner graph a boolean input and wire the outer trigger into that.',
      });
    }

    // The boundary, as one list of names that must not collide: each of these
    // nodes is a port on this one.
    const named = new Map<string, string>();
    for (const boundary of [...boundaryInputs(held, elements), ...boundaryOutputs(held, elements)]) {
      const name = boundary.label || boundary.id;
      const other = named.get(name);
      if (other) {
        found.push({
          where: `${inside}node "${boundary.id}"`,
          problem: `It is called "${name}", and so is "${other}": that is two ports of the same name on the node above.`,
          fix: 'Give one of them another label.',
        });
      }
      named.set(name, boundary.id);
    }

    for (const boundary of boundaryOutputs(held, elements)) {
      const values = carried(boundary, elements);
      if (values.length === 1) continue;
      found.push({
        where: `${inside}node "${boundary.id}"`,
        problem: `An output node inside a graph is one port of the node above, carrying one value; this one has ${values.length}.`,
        fix: values.length
          ? `It carries ${values.map((p) => `"${p.id}"`).join(', ')}. Leave it one, and give the others their own output node.`
          : 'Give it an input to carry, or delete it.',
      });
    }

    for (const inner of held.nodes) {
      const kind = elements.node(inner.node_type);
      if (kind?.hasInterface) {
        found.push({
          where: `${inside}node "${inner.id}"`,
          problem: 'A page belongs to the graph at the top; a page in here would never be shown.',
          fix: 'Move the gui node up to the graph that has the interface, and wire this one\'s output to it.',
        });
      }
      if (kind?.runtimeRequirements(inner).length) {
        found.push({
          where: `${inside}node "${inner.id}"`,
          problem: 'It asks for a value when the run starts, and only the graph at the top is asked.',
          fix: 'Give it a value of its own, or make it an input node the node above feeds.',
        });
      }
    }
    return found;
  }
}

/**
 * What went wrong in there, in one sentence.
 *
 * The run's own summary when it has one -- it names the node already -- and
 * otherwise the first node that has something to say, which is where a caught
 * failure and a partly failed fan-out leave their reason.
 */
function trouble(run: ExecutionResult): string {
  if (run.error) return run.error;
  const said = run.node_results.find((result) => result.error);
  if (said) return `${said.node_id}: ${said.error}`;
  const idle = run.node_results.filter((result) => result.status === 'skipped').length;
  return idle ? `${idle} of its nodes had nothing to do.` : 'it did not finish.';
}

/** The stored graph, or null when there is nothing readable there. */
function readGraph(stored: unknown): Graph | null {
  if (!stored || typeof stored !== 'object') return null;
  try {
    return parseGraph(structuredClone(stored));
  } catch {
    return null;
  }
}
