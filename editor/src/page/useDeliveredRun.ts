import { useRef, useState } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { syncGuiNodePorts } from '@/elements/nodes/gui/guiWidgets';
import { call, type Requirement, type RunTrigger } from '@/api/client';

/**
 * Starting a run the way the delivered tool starts one.
 *
 * Two hosts render the delivered page -- `runtime/RuntimeApp.tsx` for a bundle
 * someone was handed, and the editor's Preview tab -- and a run from either
 * has the same two steps: ask what the graph still needs (a file to read, a
 * place to write), and only then run. The preview had the second step and not
 * the first, so pressing a button there failed on a file nobody had chosen,
 * while the same press in the delivered tool politely asked for it. A preview
 * that behaves differently from the thing it previews is the one thing this
 * page is not allowed to be, so the two steps live here and both hosts use
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
    const graph = exportGraph();
    for (const requirement of requirements ?? []) {
      const key = requirement.widget_id ? `${requirement.node_id}::${requirement.widget_id}` : requirement.node_id;
      const value = values[key];
      if (value === undefined) continue;
      const node = graph.nodes.find((n) => n.id === requirement.node_id);
      if (!node) continue;
      if (requirement.widget_id) {
        const widget = node.config.gui_widgets.find((w) => w.id === requirement.widget_id);
        if (!widget) continue;
        widget.value = value;
        Object.assign(node, syncGuiNodePorts(node));
      } else {
        node.config.value = value;
      }
      // Write the answer back into the store, not just into the copy about to
      // run -- otherwise an operator running the same tool daily retypes the
      // same paths on every single run.
      updateNode(node.id, { config: node.config });
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
