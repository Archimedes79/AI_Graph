// The toolbar's Generate: every node of the graph written, front to back.
//
// `graphSweep.ts` decides the order and the rules; this assembles one node's
// writing the way the node's panel does -- the same request (`generateRequest`),
// the same answer written in (`writtenInto`), what is missing first
// (`writesFor`) -- and writes what comes back into the store, file by file.

import { useCallback, useRef, useState } from 'react';
import type { GraphEdge, GraphNode } from '@/graph';
import { ApiError, call } from '@/api/client';
import { useGraphStore } from '@/store/graphStore';
import { portRenames } from '@/store/portRenames';
import { graphEdge } from '@/document/wires';
import {
  bodyOf, exchangeName, generateRequest, generationGuard, hasDefinitions, isWritten, unfitDefinition, withHistory, writtenInto, type Write,
} from './generation';
import { inputFilesOf } from './exampleFile';
import { missingExamples, sweep, type SweepUnit } from './graphSweep';

export interface SweepState {
  run: () => Promise<void>;
  stop: () => void;
  busy: boolean;
  message: string;
  /** What it said has been read: it goes. */
  dismiss: () => void;
}

/** Said when what came back belongs to a graph that is no longer open. */
export const ANOTHER_GRAPH = 'another graph was opened, and what came back is not written into it';

/**
 * What a sweep writes of *node*: what it is missing -- its input definition
 * where it takes something in, its output definition, its body -- and never
 * what somebody wrote.
 */
export function missingOf(node: GraphNode): Write[] {
  if (!bodyOf(node)) return [];
  const writes: Write[] = hasDefinitions(node) ? ['input', 'output', 'body'] : ['body'];
  return writes.filter((write) => !isWritten(node, write) && (write !== 'input' || node.inputs.length > 0));
}

/**
 * Write every node of the open graph that is missing something, front to back,
 * saying how it goes through *say*. Written into the graph that was open when
 * it started, and only while it still is: node ids repeat from graph to graph,
 * and a body that came back for one graph's node is not the next graph's.
 */
export async function sweepGraph({ say, stopped }: { say: (message: string) => void; stopped: () => boolean }): Promise<void> {
  // Read through `getState` rather than a subscription: the sweep writes into
  // the store as it goes, and every node after the first wants what the one
  // before it just wrote.
  const live = () => useGraphStore.getState();
  const started = live().document;
  const stillOpen = () => live().document === started;
  const nodesOf = () => live().rfNodes.map((item) => item.data.graphNode);
  const dslEdges = (): GraphEdge[] => live().rfEdges.map(graphEdge);
  const nodeNow = (id: string) => nodesOf().find((node) => node.id === id);

  const missing = missingExamples(nodesOf(), dslEdges());
  if (missing.length) {
    say(`❌ ${missing.map((n) => n.label || n.id).join(', ')}: give it a file or folder to read by default. `
      + 'Without one, the first node is written against nothing and every node after it inherits the guess.');
    return;
  }

  /** *node* with *next* written in, its wires following its outputs. */
  const put = (before: GraphNode, next: GraphNode) => live().updateNode(before.id, next, portRenames(before, next));

  const unitFor = (node: GraphNode): SweepUnit | undefined => {
    const current = nodeNow(node.id) ?? node;
    const writes = missingOf(current);
    if (!writes.length) return undefined;
    return {
      guard: () => generationGuard(current),
      write: async () => {
        for (const write of writes) {
          const now = nodeNow(node.id);
          if (!now || !stillOpen()) throw new Error(ANOTHER_GRAPH);
          const around = { nodes: nodesOf(), edges: live().rfEdges, metadata: live().metadata };
          const request = generateRequest(now, write, around, inputFilesOf(now, around.nodes, around.edges, live().executionResult));
          const name = exchangeName(now, write);
          try {
            const response = await call('generate', request);
            const latest = nodeNow(node.id);
            if (!latest || !stillOpen()) throw new Error(ANOTHER_GRAPH);
            put(latest, writtenInto(latest, write, response, name));
            // Written, to be seen; the rest of the node would be written against it.
            const unfit = unfitDefinition(write, response.probe);
            if (unfit) throw new Error(`${name}: ${unfit}`);
          } catch (error) {
            // A failed exchange is history too, where it is still this graph's.
            const calls = error instanceof ApiError ? error.body.calls : undefined;
            const latest = nodeNow(node.id);
            if (calls?.length && latest && stillOpen()) {
              live().updateNode(node.id, { config: { ...latest.config, history: withHistory(latest, `${name} (failed)`, calls) } });
            }
            throw error;
          }
        }
      },
    };
  };

  let written = 0;
  const held: string[] = [];
  try {
    for await (const step of sweep(nodesOf(), dslEdges(), { unitFor, stopped: () => stopped() || !stillOpen() })) {
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
  const dismiss = useCallback(() => setMessage(''), []);

  return { run, stop, busy, message, dismiss };
}
