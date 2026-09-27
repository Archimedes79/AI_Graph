import { useState } from 'react';
import type { GraphNode } from '@/graph';
import { schemaOutline } from '@engine/execution/interface.ts';
import { DIMMER, LINE, MUTED, NEUTRAL_BUTTON, SUNKEN, TEXT } from '@/ui/theme';

interface OutputInterfaceProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
}

/**
 * The kept shape in one line, a port at a time -- `output: list of text` --
 * with the JSON Schema a click away. Each port as the engine outlines a shape
 * for ✨ and the nodes after this one (`schemaOutline`): a second outline here
 * said "number" where they were told "whole number", and printed a list of
 * types as "number,string".
 */
export function outline(schema: unknown): string {
  const properties = (schema as { properties?: unknown } | null)?.properties;
  if (!properties || typeof properties !== 'object') return schemaOutline(schema);
  return Object.entries(properties).map(([port, part]) => `${port}: ${schemaOutline(part)}`).join(' · ');
}

/**
 * What this node's outputs look like, as a JSON Schema: its output interface.
 *
 * Not designed here, and not typed: measured. The first successful run writes
 * down what came out (see `graphStore.setExecutionResult`), and so does ✨'s
 * verify pass when it tried the code on a sample; from then on every run is
 * checked against it, and the nodes after this one are generated against it.
 * Shown for reading, folded. Clearing it lets the next run measure it again,
 * which is what to do after changing the node on purpose. In a project it is
 * `output_schema` in the node's `interface.json`.
 */
export default function OutputInterface({ node, setConfig }: OutputInterfaceProps) {
  const [note, setNote] = useState('');
  const schema = node.config.output_schema;

  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-3">
        <label className="text-xs font-medium" style={{ color: MUTED }}>
          Shape kept from a run
        </label>
        {schema != null && (
          <button className="text-xs px-2 py-1 rounded" style={NEUTRAL_BUTTON}
            title="Forget it: the next successful run, or ✨'s next try of the code, measures it again"
            onClick={() => { setConfig('output_schema', null); setNote('Cleared: the next successful run sets it again.'); }}>
            Clear
          </button>
        )}
      </div>
      {schema != null ? (
        <details>
        <summary className="text-xs cursor-pointer select-none" style={{ color: TEXT }}>{outline(schema)}</summary>
        <pre
          className="text-xs rounded-lg px-3 py-2 overflow-auto font-mono"
          style={{ background: SUNKEN, color: TEXT, border: `1px solid ${LINE}`, maxHeight: 180 }}
        >
          {JSON.stringify(schema, null, 2)}
        </pre>
        </details>
      ) : (
        <p className="text-xs" style={{ color: DIMMER }}>
          None yet. The first successful run sets it from what this node produced; later runs are checked against it,
          and the nodes after this one are generated against it.
        </p>
      )}
      {note && <p className="text-xs mt-1" style={{ color: MUTED }}>{note}</p>}
    </div>
  );
}
