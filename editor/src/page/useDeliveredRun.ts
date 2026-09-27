import { useRef, useState } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { call, type Requirement, type RunTrigger } from '@/api/client';
import type { Graph } from '@/graph';
import { applyRuntimeValues } from '@engine/execution/runtimeValues.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';

/**
 * Starting a run the way the delivered tool starts one.
 *
 * Two hosts render the delivered page -- `runtime/RuntimeApp.tsx` for a bundle
 * someone was handed, and the editor's Preview tab -- and the toolbar's ▶ Run
 * of a graph without a page is the same run again. A run from any of them
 * has the same two steps: ask what the graph still needs (a file to read, a
 * place to write), and only then run. The preview had the second step and not
 * the first, so pressing a button there failed on a file nobody had chosen,
 * while the same press in the delivered tool politely asked for it. A preview
 * that behaves differently from the thing it previews is the one thing this
 * page is not allowed to be, so the two steps live here and every host uses
 * them.
 *
 * A page event brings the port it fired on, and the run is then only what that
 * port is wired to; ▶ Run brings none, and runs everything.
 */
export function useDeliveredRun() {
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const updateNode = useGraphStore((s) => s.updateNode);
  const runGraph = useGraphStore((s) => s.runGraph);

  const [requirements, setRequirements] = useState<Requirement[] | null>(null);
  const pending = useRef<RunTrigger | null>(null);

  const run = async (trigger: RunTrigger | null = null) => {
    const graph = exportGraph();
    try {
      const needed = await call('requirements', graph);
      if (needed.length > 0) {
        pending.current = trigger;
        setRequirements(needed);
        return;
      }
    } catch {
      // Requirements are an optimisation; if the check fails, just run and let
      // the engine report a missing value properly.
    }
    await runGraph(graph, trigger);
  };

  const submit = async (values: Record<string, string>) => {
    // A copy: the answers are written into it before it is handed to the run.
    const graph: Graph = JSON.parse(JSON.stringify(exportGraph()));
    // Where an answer goes is each element's own business (`applyRuntimeValue`:
    // an input keeps it as its value, a page in the block that asked) -- the
    // engine's code, run here, rather than a second copy of it.
    const answered = applyRuntimeValues(graph, values, engineRegistry);
    // Write the answers back into the store, not just into the copy about to
    // run -- otherwise an operator running the same tool daily retypes the
    // same paths on every single run.
    for (const node of graph.nodes) {
      if (answered.has(node.id)) updateNode(node.id, { config: node.config });
    }
    setRequirements(null);
    const trigger = pending.current;
    pending.current = null;
    await runGraph(graph, trigger);
  };

  const cancel = () => {
    pending.current = null;
    setRequirements(null);
  };

  return { run, requirements, submit, cancel };
}
