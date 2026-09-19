import { useState } from 'react';
import type { ExecutionResult, GraphNode } from '@/graph';
import { inferInterface } from '@engine/execution/interface.ts';
import { DIMMER, LINE, MUTED, NEUTRAL_BUTTON, SUNKEN, TEXT } from '@/ui/theme';

interface OutputInterfaceProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  executionResult: ExecutionResult | null;
}

/**
 * What this node's outputs look like, as a JSON Schema: its output interface.
 *
 * Not designed here. Nodes are wired, the graph runs, and the first successful
 * run writes down what came out (see `graphStore.setExecutionResult`); from
 * then on every run is checked against it, and the nodes after this one are
 * generated against it. "Set from last run" is for when the node was changed
 * on purpose. In a project it is `output.schema.json`, for editing by hand.
 */
export default function OutputInterface({ node, setConfig, executionResult }: OutputInterfaceProps) {
  const [note, setNote] = useState('');
  const schema = node.config.output_schema;
  const ran = executionResult?.node_results.find((r) => r.node_id === node.id && r.status === 'success');

  const setFromRun = () => {
    if (!ran || !Object.keys(ran.outputs ?? {}).length) {
      setNote('Run the graph first: the interface is what a successful run of this node produced.');
      return;
    }
    setConfig('output_schema', inferInterface(ran.outputs));
    setNote('Set from the last run.');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-3">
        <label className="text-xs font-medium" style={{ color: MUTED }}>
          Output interface
        </label>
        <div className="flex items-center gap-2">
          <button className="text-xs px-2 py-1 rounded" style={NEUTRAL_BUTTON} onClick={setFromRun}
            title="Describe this node's outputs as the last successful run produced them">
            Set from last run
          </button>
          {schema != null && (
            <button className="text-xs px-2 py-1 rounded" style={NEUTRAL_BUTTON}
              onClick={() => { setConfig('output_schema', null); setNote('Cleared: the next successful run sets it again.'); }}>
              Clear
            </button>
          )}
        </div>
      </div>
      {schema != null ? (
        <pre
          className="text-xs rounded-lg px-3 py-2 overflow-auto font-mono"
          style={{ background: SUNKEN, color: TEXT, border: `1px solid ${LINE}`, maxHeight: 180 }}
        >
          {JSON.stringify(schema, null, 2)}
        </pre>
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
