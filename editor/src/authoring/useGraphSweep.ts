// The ✨ Generate-all button's state machine.
//
// `graphSweep.ts` decides the order and the rules; this assembles one node's
// generation the way the node editor does — through `buildGeneration`, so the
// button in the main window and the button in the editor send the same request
// — and writes what comes back into the store.

import { useCallback, useRef, useState } from 'react';
import type { GraphEdge, GraphNode, GuiWidget } from '@/graph';
import type { GenerateResponse } from '@/api/client';
import { shapeToKeep, useGraphStore } from '@/store/graphStore';
import { graphEdge } from '@/document/wires';
import { showsPage } from '@/document/guiWidgets';
import { nodeFacts } from './nodeFacts';
import { WIDGET_BUILDERS, NODE_BUILDERS } from '@/elements/registry';
import { buildGeneration, nodeFields, widgetFields } from './generation';
import { missingExamples, sampleFromPredecessors, sweep, writtenBody, type SweepTarget, type SweepUnit } from './graphSweep';

export interface SweepState {
  run: () => Promise<void>;
  stop: () => void;
  busy: boolean;
  message: string;
}

/** Said when what came back belongs to a graph that is no longer open. */
export const ANOTHER_GRAPH = 'another graph was opened, and what came back is not written into it';

/**
 * Write every empty node of the open graph, front to back, saying how it goes
 * through *say*. Written into the graph that was open when it started, and
 * only while it still is: node ids repeat from graph to graph, and a body
 * that came back for one graph's `code` is not the next graph's.
 */
export async function sweepGraph({ say, stopped }: { say: (message: string) => void; stopped: () => boolean }): Promise<void> {
  // Read through `getState` rather than a subscription: the sweep writes into
  // the store as it goes, and every node after the first wants what the one
  // before it just wrote.
  const live = () => useGraphStore.getState();
  const started = live().document;
  const stillOpen = () => live().document === started;
  const nodesOf = () => live().rfNodes.map((item) => item.data.graphNode);
  const rfEdges = () => live().rfEdges;
  const dslEdges = (): GraphEdge[] => rfEdges().map(graphEdge);

  const missing = missingExamples(nodesOf(), dslEdges());
  if (missing.length) {
    say(`❌ ${missing.map((n) => n.label || n.id).join(', ')}: give it a file or folder to read by default. `
      + 'Without one, the first node is written against nothing and every node after it inherits the guess.');
    return;
  }

  // What each generated node returned in its verify pass, so the node after
  // it is generated against real values even when the graph has never run.
  const produced = new Map<string, Record<string, unknown>>();

  const guiNodes = new Set(nodesOf().filter((n) => showsPage(n.node_type)).map((n) => n.id));

  /**
   * One unit, written only into the graph it was asked for: refused, which
   * stops the sweep and says why, once another graph is open.
   */
  const inThisGraph = (unit: SweepUnit<GenerateResponse>, key: string): SweepUnit<GenerateResponse> => ({
    ...unit,
    apply: (result) => {
      if (!stillOpen()) throw new Error(ANOTHER_GRAPH);
      unit.apply(result);
      // Filed under the target, so the one after it -- which may be a block,
      // a node away -- is generated against what this one really returned.
      if (result.probe?.outputs) produced.set(key, result.probe.outputs);
    },
  });

  /** One block on a page, generated exactly as its own ✨ button would. */
  const unitForWidget = (
    target: SweepTarget & { widget: GuiWidget },
  ): SweepUnit<GenerateResponse> | undefined => {
    const element = WIDGET_BUILDERS[target.widget.kind as keyof typeof WIDGET_BUILDERS];
    const spec = element?.generation;
    if (!spec) return undefined;

    const node = nodesOf().find((n) => n.id === target.node.id);
    const widget = (node?.config.gui_widgets ?? []).find((w) => w.id === target.widget.id);
    if (!node || !widget) return undefined;
    if (spec.available && !spec.available(widget)) return undefined;

    // Never overwrite a body somebody already has, the same rule a node gets.
    const written = String((widget as unknown as Record<string, unknown>)[spec.targetField] ?? '').trim();
    if (written) return undefined;

    const onChange = (patch: Partial<GuiWidget>) => {
      const latest = nodesOf().find((n) => n.id === node.id);
      if (!latest) return;
      useGraphStore.getState().updateNode(node.id, {
        config: {
          ...latest.config,
          gui_widgets: latest.config.gui_widgets.map((w) => (w.id === widget.id ? { ...w, ...patch } : w)),
        } as GraphNode['config'],
      });
    };

    // The same request its own ✨ button sends.
    return inThisGraph(buildGeneration({
      element: widget.kind, generation: spec, subject: widget, fields: widgetFields(widget, onChange),
    }), target.key);
  };

  const unitFor = (target: SweepTarget): SweepUnit<GenerateResponse> | undefined => {
    if (target.widget) return unitForWidget(target as SweepTarget & { widget: GuiWidget });
    const node = target.node;
    const element = NODE_BUILDERS[node.node_type];
    const spec = element?.generation;
    if (!spec) return undefined;

    const current = nodesOf().find((n) => n.id === node.id) ?? node;
    if (spec.available && !spec.available(current)) return undefined;

    // Never overwrite a body somebody already has. A sweep fills a graph in;
    // rewriting working code because a button was pressed is not that. What
    // a new node of the kind starts with is nobody's work, though.
    if (writtenBody(current, spec.targetField)) return undefined;

    const setConfig = (key: string, value: unknown) => {
      const node_ = nodesOf().find((n) => n.id === current.id);
      if (!node_) return;
      useGraphStore.getState().updateNode(current.id, {
        config: { ...node_.config, [key]: value } as GraphNode['config'],
      });
    };
    const fields = nodeFields(
      current, setConfig,
      (value) => useGraphStore.getState().updateNode(current.id, { description: value }),
    );

    const facts = nodeFacts(current, nodesOf(), rfEdges(), live().executionResult);
    // Its own example wins, as in its dialog; what the nodes before it just
    // returned stands in only where the node has nothing else to go on.
    const ownSample = facts.sampleInputs || element.exampleInput(current);
    const predecessors = ownSample ? undefined : sampleFromPredecessors(target, rfEdges(), produced, guiNodes);
    return inThisGraph(buildGeneration({
      element: node.node_type,
      generation: spec,
      subject: current,
      fields,
      // The same facts the node's dialog sends: a sweep must not tell the
      // model less than the ✨ button on the node would.
      ...facts,
      // Before a run, what the nodes before it produced in this sweep.
      ...(predecessors ? { sampleInputs: predecessors, sampleOrigin: 'what the nodes before it just returned' } : {}),
      // What it turns out to return is kept as this node's shape, which is
      // what the next node is then generated against.
      recordShape: (outputs) => {
        const now = nodesOf().find((n) => n.id === current.id);
        const kept = now && shapeToKeep(now, outputs);
        if (kept) setConfig('output_schema', kept);
      },
    }), target.key);
  };

  let written = 0;
  const held: string[] = [];
  try {
    for await (const step of sweep<GenerateResponse>(nodesOf(), dslEdges(), {
      unitFor, stopped: () => stopped() || !stillOpen(),
    })) {
      if (step.status === 'failed') {
        say(`⚠️ Stopped at ${step.label}: ${step.message}`);
        return;
      }
      if (step.status === 'generated') {
        written += 1;
        say(`Generating… ${step.label} written`);
      }
      if (step.status === 'blocked') held.push(`${step.label} (${step.message})`);
    }
    if (!stillOpen()) {
      say(`⚠️ Stopped: ${ANOTHER_GRAPH}.`);
      return;
    }
    const rest = held.length ? ` ${held.length} left alone: ${held.join(', ')}` : '';
    say(written ? `✅ ${written} written.${rest}` : `Nothing to generate.${rest}`);
  } catch (error) {
    say(`⚠️ ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function useGraphSweep(): SweepState {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const stopping = useRef(false);

  const run = useCallback(async () => {
    stopping.current = false;
    setBusy(true);
    try {
      await sweepGraph({ say: setMessage, stopped: () => stopping.current });
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(() => { stopping.current = true; }, []);

  return { run, stop, busy, message };
}
