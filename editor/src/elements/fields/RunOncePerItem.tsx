import { useRef } from 'react';
import type { GraphNode } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { listPorts, runsPerItem, withPerItem } from '@/authoring/perItem';
import { hasDefinitions } from '@/authoring/generation';
import { definitionExample, definitionsIn } from '@engine/authoring/definition.ts';
import { ONCE, type NodeAdvancedPanelProps } from '../NodeGuiBuilder';
import { DIMMER, MUTED } from '@/ui/theme';

/** The example in *node*'s input.js, where it has one that can be read. */
function exampleOf(node: GraphNode): Record<string, unknown> | undefined {
  const input = definitionsIn(node).input;
  if (!input.trim()) return undefined;
  const read = definitionExample(input);
  return 'example' in read ? read.example : undefined;
}

/**
 * "Run once per item": the one question about a list, asked only when a list
 * arrives -- down a wire, as a port declared one, or in the example. Ticked, a
 * list is taken an item at a time and what comes out is a list of the results;
 * an input can then be taken whole beside it ("whole list", in the ports).
 */
export default function RunOncePerItem({ node, updateNode, subject }: Pick<NodeAdvancedPanelProps, 'node' | 'updateNode'> & { subject: string }) {
  const nodes = useGraphStore((s) => s.rfNodes.map((item) => item.data.graphNode));
  const edges = useGraphStore((s) => s.rfEdges);
  const lists = listPorts(node, exampleOf(node), nodes, edges);
  // Once asked, the question stays while the panel is open: unticked, no input
  // is declared a list any more, and the box would vanish under the click.
  const asked = useRef(false);
  if (lists.length || runsPerItem(node)) asked.current = true;
  if (!asked.current) return null;
  const checked = runsPerItem(node);
  const oneCall = hasDefinitions(node) ? ' -- input.js and output.js say one call;' : ';';
  return (
    <div>
      <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
        <input type="checkbox" checked={checked} aria-label="Run once per item"
          onChange={(event) => updateNode((current) => withPerItem(current, event.target.checked, lists), ONCE)} />
        Run once per item
      </label>
      <p className="text-xs mt-0.5" style={{ color: DIMMER }}>
        {checked
          ? `A list arrives, and ${subject} runs once for each item in it${oneCall} what comes out is a list of the results.`
          : `A list arrives, and ${subject} gets it whole, once -- for totals, summaries, merges.`}
      </p>
    </div>
  );
}
