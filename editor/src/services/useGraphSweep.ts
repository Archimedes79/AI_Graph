// The ✨ Generate-all button's state machine.
//
// `graphSweep.ts` decides the order and the rules; this assembles one node's
// generation the way the node editor does — through `buildGeneration`, so the
// button in the main window and the button in the editor send the same request
// — and writes what comes back into the store.

import { useCallback, useRef, useState } from 'react';
import type { GraphEdge, GraphNode } from '../types/graph';
import type { GenerationResult } from '../utils/api';
import { useGraphStore } from '../store/graphStore';
import { NODE_ELEMENTS } from '../elements/registry';
import { buildGeneration, nodeFields } from '../elements/shared/generation';
import {
  connectedFormatContext, inputSources, lastRunContext, lastRunInputs,
} from '../elements/shared/generationContext';
import { missingExamples, sampleFromPredecessors, sweep, type SweepUnit } from './graphSweep';

export interface SweepState {
  run: () => Promise<void>;
  stop: () => void;
  busy: boolean;
  message: string;
}

export function useGraphSweep(): SweepState {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const stopping = useRef(false);

  const run = useCallback(async () => {
    // Read through `getState` rather than a subscription: the sweep writes into
    // the store as it goes, and every node after the first wants what the one
    // before it just wrote.
    const live = () => useGraphStore.getState();
    const nodesOf = () => live().rfNodes.map((item) => item.data.graphNode);
    const rfEdges = () => live().rfEdges;
    const dslEdges = (): GraphEdge[] => rfEdges().map((edge) => ({
      id: edge.id,
      source_node_id: edge.source,
      target_node_id: edge.target,
      source_port_id: edge.sourceHandle ?? '',
      target_port_id: edge.targetHandle ?? '',
    } as GraphEdge));

    const missing = missingExamples(nodesOf(), dslEdges());
    if (missing.length) {
      setMessage(`❌ ${missing.map((n) => n.label || n.id).join(', ')}: attach a default file, or say what `
        + 'the files contain. Without either, the first node is written against nothing and every node '
        + 'after it inherits the guess.');
      return;
    }

    // What each generated node returned in its verify pass, so the node after
    // it is generated against real values even when the graph has never run.
    const produced = new Map<string, Record<string, unknown>>();

    const unitFor = (node: GraphNode): SweepUnit<GenerationResult> | undefined => {
      const element = NODE_ELEMENTS[node.node_type];
      const spec = element?.generation;
      if (!spec) return undefined;

      const current = nodesOf().find((n) => n.id === node.id) ?? node;
      if (spec.available && !spec.available(current)) return undefined;

      // Never overwrite a body somebody already has. A sweep fills a graph in;
      // rewriting working code because a button was pressed is not that.
      const written = String((current.config as unknown as Record<string, unknown>)[spec.targetField] ?? '').trim();
      if (written) return undefined;

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

      const unit = buildGeneration({
        element: node.node_type,
        generation: spec,
        subject: current,
        fields,
        ports: {
          inputs: current.inputs.map((port) => port.id),
          outputs: current.outputs.map((port) => port.id),
        },
        exampleFile: current.config.example_file,
        graphContext: [
          connectedFormatContext(current.id, nodesOf(), rfEdges()),
          lastRunContext(current.id, live().executionResult),
        ].filter(Boolean).join('\n\n'),
        sampleInputs: lastRunInputs(current.id, live().executionResult)
          ?? sampleFromPredecessors(current.id, rfEdges(), produced),
        inputSources: inputSources(current.id, nodesOf(), rfEdges()),
        // What it turns out to return is written down as this node's contract,
        // which is what the next node is then generated against.
        recordMeasuredOutput: true,
      });
      return {
        ...unit,
        apply: (result) => {
          unit.apply(result);
          if (result.probe?.outputs) produced.set(current.id, result.probe.outputs);
        },
      };
    };

    stopping.current = false;
    setBusy(true);
    let written = 0;
    const held: string[] = [];
    try {
      for await (const step of sweep<GenerationResult>(nodesOf(), dslEdges(), {
        unitFor, stopped: () => stopping.current,
      })) {
        if (step.status === 'failed') {
          setMessage(`⚠️ Stopped at ${step.label}: ${step.message}`);
          return;
        }
        if (step.status === 'generated') {
          written += 1;
          setMessage(`Generating… ${step.label} written`);
        }
        if (step.status === 'blocked') held.push(`${step.label} (${step.message})`);
      }
      const rest = held.length ? ` ${held.length} left alone: ${held.join(', ')}` : '';
      setMessage(written ? `✅ ${written} written.${rest}` : `Nothing to generate.${rest}`);
    } catch (error) {
      setMessage(`⚠️ ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(() => { stopping.current = true; }, []);

  return { run, stop, busy, message };
}
