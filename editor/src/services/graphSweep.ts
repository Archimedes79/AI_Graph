// Generating a whole graph, front to back.
//
// One ✨ button generates one element against whatever its neighbours happen to
// declare. That is fine for a node added to a working graph and useless for a
// graph that is empty: every node is generated against a guess, because the
// node it reads from has not been written yet.
//
// So the order matters, and it is the *execution* order — asked of the engine
// (`topologicalLevels`) rather than derived again here, so a graph is generated
// in the order it will run, including the memory-feedback rule that keeps
// `gui → ai → gui` from looking like a cycle.
//
// What travels forward is what the run produced: each node is generated, then
// actually run against its predecessor's data by the verify pass the backend
// already does, and what it returned becomes the contract the next node is
// generated against. A small local model guesses badly from a description and
// well from three lines of real data, and from the second node on there is real
// data to be had.

import { memoryFeedbackEdges, topologicalLevels } from '@engine/executor.ts';
import { registry } from '@engine/registry.ts';
import type { GraphEdge, GraphNode, GuiWidget } from '../types/graph';
import { guiWidgetPorts } from '../utils/guiWidgets';

/** What happened to one node. */
export type SweepStatus =
  /** Written. */
  | 'generated'
  /** Nothing to generate here — an output node, a divider, a node already written. */
  | 'skipped'
  /** Could be generated, but something is missing: usually the request itself. */
  | 'blocked'
  /** The generation itself failed. The sweep stops here. */
  | 'failed';

export interface SweepStep {
  nodeId: string;
  label: string;
  status: SweepStatus;
  message: string;
}

/**
 * One node's generation, already assembled by the caller.
 *
 * The same three parts `useGenerate` runs for a single button — so a sweep and
 * a button generate through one code path, and a change to how a request is
 * built cannot apply to only one of them.
 */
export interface SweepUnit<T = unknown> {
  guard?: () => string | undefined;
  /** Takes the id a watcher would poll; a sweep passes none and nobody watches. */
  run: (progressId?: string) => Promise<T>;
  apply: (result: T) => void;
}

/**
 * One thing to generate: a node, or a block on a node's page.
 *
 * The sweep used to walk nodes alone, and a gui node generates nothing itself
 * -- so a page's blocks, which are where a chart transform and a file selector
 * live, were skipped entirely however often the button was pressed.
 */
export interface SweepTarget {
  node: GraphNode;
  /** Set when the target is a block rather than the node itself. */
  widget?: GuiWidget;
  /** `nodeId`, or `nodeId::widgetId`. What a produced sample is filed under. */
  key: string;
  label: string;
}

export interface SweepDeps<T = unknown> {
  /** The unit for this target, or undefined when it generates nothing. */
  unitFor: (target: SweepTarget) => SweepUnit<T> | undefined;
  /** Asked before each target, so a long sweep can be stopped from the toolbar. */
  stopped?: () => boolean;
}

/** The key a block's outputs are filed under, so an edge can find them again. */
export function targetKey(nodeId: string, widgetId?: string): string {
  return widgetId ? `${nodeId}::${widgetId}` : nodeId;
}

/**
 * A block's ports, named the way the graph's edges name them.
 *
 * `${id}_in` and `${id}_out` are what the gui node contributes upward, so an
 * edge into a page is really an edge into one of its blocks -- which is what
 * makes an order across the two possible at all.
 */
function blockPorts(widget: GuiWidget): { inputs: string[]; outputs: string[] } {
  const ports = guiWidgetPorts(widget);
  return {
    inputs: ports.inputs.map((port) => port.id),
    outputs: ports.outputs.map((port) => port.id),
  };
}

/**
 * The nodes in the order they would run.
 *
 * Flattened: a stage's nodes are independent of each other, so any order within
 * one is as good as another, and a flat list is what a progress line shows.
 *
 * Throws on a cycle the memory rule cannot absolve — the engine's own refusal,
 * raised here rather than worked around. A graph that cannot run has no order to
 * generate in, and inventing one would write every node against a guess while
 * looking like it worked.
 */
export function generationOrder(nodes: GraphNode[], edges: GraphEdge[]): SweepTarget[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  /**
   * The graph with every page opened up.
   *
   * A page is not a chain: its blocks have no edges among themselves, and what
   * order they belong in runs out through the graph and back --
   * picker -> code node -> chart. So the blocks stand in the graph in their
   * node's place, and one topological sort answers for both kinds at once.
   */
  const targets = new Map<string, SweepTarget>();
  const virtualNodes: { id: string; node_type: string }[] = [];
  const portOwner = new Map<string, string>();

  for (const node of nodes) {
    const widgets = node.node_type === 'gui' && Array.isArray(node.config.gui_widgets)
      ? node.config.gui_widgets as GuiWidget[]
      : [];
    const blocks = widgets.filter((widget) => {
      const ports = blockPorts(widget);
      return ports.inputs.length > 0 || ports.outputs.length > 0;
    });

    if (!blocks.length) {
      const key = targetKey(node.id);
      targets.set(key, { node, key, label: node.label || node.id });
      virtualNodes.push({ id: key, node_type: node.node_type });
      continue;
    }

    for (const widget of blocks) {
      const key = targetKey(node.id, widget.id);
      targets.set(key, {
        node,
        widget,
        key,
        label: `${node.label || node.id} / ${widget.label || widget.id}`,
      });
      // Keeps its node's type, so the memory rule below still recognises a
      // block of a page as something that remembers.
      virtualNodes.push({ id: key, node_type: node.node_type });
      for (const port of [...blockPorts(widget).inputs, ...blockPorts(widget).outputs]) {
        portOwner.set(`${node.id}::${port}`, key);
      }
    }
  }

  /** Which target an edge end belongs to: a block when the port names one. */
  const endpoint = (nodeId: string, portId: string): string =>
    portOwner.get(`${nodeId}::${portId}`) ?? targetKey(nodeId);

  const virtualEdges = edges
    .map((edge) => ({
      id: edge.id,
      source_node_id: endpoint(edge.source_node_id, edge.source_port_id),
      source_port_id: edge.source_port_id,
      target_node_id: endpoint(edge.target_node_id, edge.target_port_id),
      target_port_id: edge.target_port_id,
    }))
    // An edge between two blocks of the same page would be a self-loop here,
    // and a self-loop is a cycle the sort cannot resolve.
    .filter((edge) => edge.source_node_id !== edge.target_node_id);

  /**
   * Which cycles the memory rule absolves -- decided on the opened-up graph.
   *
   * On the graph as written, picker -> code -> chart is a loop through one gui
   * node, so the edge back into the page was cut and the chart was generated
   * before the node that feeds it. Opened up those are two different blocks
   * and there is no loop at all; a loop that survives the expansion is a real
   * one, and the rule still absolves it if it closes into a page.
   */
  const feedback = memoryFeedbackEdges(virtualNodes as never, virtualEdges as never, registry);

  const ordered: SweepTarget[] = [];
  for (const level of topologicalLevels(virtualNodes as never, virtualEdges as never, feedback)) {
    for (const key of level) {
      const target = targets.get(key);
      if (target) ordered.push(target);
    }
  }
  // A node the sort never reached -- one whose only edges were dropped above --
  // still has something to generate.
  for (const [key, target] of targets) {
    if (!ordered.some((seen) => seen.key === key)) ordered.push(target);
  }
  if (byId.size === 0) return [];
  return ordered;
}

/**
 * Generate every node that has something to generate, in order.
 *
 * Yields one step per node so the caller can show progress as it happens rather
 * than a frozen button and a list at the end.
 *
 * A blocked node does not stop the sweep — a node with no request of its own may
 * still have a body that works, and the nodes after it are worth writing. A
 * *failed* one does stop it: everything downstream would be generated against a
 * contract that was never produced, which is a worse outcome than stopping with
 * half a graph written.
 */
export async function* sweep<T>(
  nodes: GraphNode[],
  edges: GraphEdge[],
  deps: SweepDeps<T>,
): AsyncGenerator<SweepStep> {
  for (const target of generationOrder(nodes, edges)) {
    if (deps.stopped?.()) return;

    const { node, label } = target;
    const unit = deps.unitFor(target);
    if (!unit) {
      yield { nodeId: node.id, label, status: 'skipped', message: 'nothing to generate' };
      continue;
    }

    const blocked = unit.guard?.();
    if (blocked) {
      yield { nodeId: node.id, label, status: 'blocked', message: blocked };
      continue;
    }

    try {
      const result = await unit.run();
      unit.apply(result);
      yield { nodeId: node.id, label, status: 'generated', message: 'written' };
    } catch (error) {
      yield {
        nodeId: node.id,
        label,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
      return;
    }
  }
}

/**
 * The nodes a sweep would have to guess at, before it starts.
 *
 * A node at the head of the graph has no predecessor to describe its data, so
 * it has to say what it holds: an attached sample (the strong form — the model
 * sees the real thing) or a stated contract (the weak one). With neither, the
 * first generation is written against nothing and the mistake is carried the
 * whole way down. Saying so before ten model calls start is cheaper than
 * reading it in the results.
 */
export function missingExamples(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const fed = new Set(edges.map((edge) => edge.target_node_id));
  return nodes.filter((node) => {
    if (node.node_type === 'input') {
      if (fed.has(node.id)) return false;               // its path port is overridden from upstream
      const mode = String(node.config.input_mode ?? 'text');
      if (mode === 'text') return false;                // its value IS the example
      return !String(node.config.example_file ?? '').trim()
        && !String(node.config.output_format_prompt ?? '').trim();
    }
    if (node.node_type === 'gui') {
      // A file-picker block is a source exactly like an input node in file or
      // directory mode -- it has no input port at all, so nothing upstream can
      // ever feed it, and nothing describes what it will hold until a person
      // attaches a default path. Checked per widget, not gated on whether the
      // *node* is fed: a gui node with an unfilled picker beside a fed text box
      // is still a guess at the picker.
      const widgets = Array.isArray(node.config.gui_widgets) ? node.config.gui_widgets : [];
      return widgets.some((widget) => widget.kind === 'input_picker' && !String(widget.value ?? '').trim());
    }
    return false;
  });
}

/** An edge as ReactFlow holds it: which port feeds which. */
export interface WiredEdge { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }

/**
 * What *nodeId* would receive, assembled from what its predecessors returned
 * when they were generated.
 *
 * This is the sweep's whole advantage over pressing the buttons one by one:
 * the verify pass runs generated code against real values, and from the second
 * node on there are real values to be had -- the ones the node before it just
 * produced in its own verify pass -- without a run having happened. A port fed
 * by several edges gets a list, as it would in a run; a port whose source
 * produced nothing yet is left out, so a partial sample is still a sample.
 */
export function sampleFromPredecessors(
  target: SweepTarget,
  edges: WiredEdge[],
  produced: Map<string, Record<string, unknown>>,
  guiNodes: Set<string> = new Set(),
): Record<string, unknown> | undefined {
  /** Which target an edge end belongs to, by the shape of its port name. */
  const keyFor = (nodeId: string, handle: string | null | undefined): string => {
    if (!handle || !guiNodes.has(nodeId)) return nodeId;
    const owner = /^(.+)_(in|out)$/.exec(handle);
    return owner ? targetKey(nodeId, owner[1]) : nodeId;
  };

  const sample: Record<string, unknown[]> = {};
  for (const edge of edges) {
    if (keyFor(edge.target, edge.targetHandle) !== target.key) continue;
    const outputs = produced.get(keyFor(edge.source, edge.sourceHandle));
    const port = edge.sourceHandle ?? 'output';
    if (!outputs || !(port in outputs)) continue;
    // A block's transform is handed `{value: ...}`, not its port name: that is
    // the shape its own contract promises it.
    const into = target.widget ? 'value' : (edge.targetHandle ?? 'input');
    (sample[into] ??= []).push(outputs[port]);
  }
  const entries = Object.entries(sample);
  if (!entries.length) return undefined;
  return Object.fromEntries(entries.map(([port, values]) => [port, values.length === 1 ? values[0] : values]));
}
