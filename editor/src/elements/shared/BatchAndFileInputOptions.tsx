import React from 'react';
import type { GraphNode } from '../../types/graph';
import { DIMMER, MUTED } from '../../ui/theme';

interface Props {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  /** What the node runs, for the help text: "this prompt" vs "this code". */
  subject: 'prompt' | 'code';
}

/**
 * The two execution switches every runnable node has: whether a list input
 * arrives item by item or all at once, and whether `file_path` inputs are read
 * from disk first.
 *
 * They mean the same thing for an AI node and a Code node -- `batch_mode` and
 * `read_file_inputs` are handled by the executor, not by the element -- so the
 * controls and their explanations lived twice, identical apart from one word.
 * That is what elements/shared/ is for; the two ConfigEditors stay separate.
 */
export default function BatchAndFileInputOptions({ node, setConfig, subject }: Props) {
  return (
    <>
      <div>
        <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <input
            type="checkbox"
            checked={node.config.catch_errors === true}
            onChange={(e) => setConfig('catch_errors', e.target.checked)}
          />
          Catch failures instead of ending the run
        </label>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Off, a failure in {subject === 'code' ? 'this code' : 'this prompt'} stops the run and
          everything downstream is skipped. On, this node grows an{' '}
          <strong style={{ color: '#a78bfa' }}>Error</strong> output carrying the reason, its
          other outputs carry nothing, and the run goes on. Wiring that output is optional —
          leave it unconnected and the run simply continues.
        </p>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <input
            type="checkbox"
            checked={node.config.batch_mode === 'whole_list'}
            onChange={(e) => setConfig('batch_mode', e.target.checked ? 'whole_list' : 'per_item')}
          />
          Run once on the whole input array
        </label>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Leave unchecked to run this {subject} separately for each item in a list input (default).
          Check this to receive the entire array at once — useful for totals, summaries, or merges.
        </p>
      </div>
      <div>
        <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <input
            type="checkbox"
            checked={!!node.config.read_file_inputs}
            onChange={(e) => setConfig('read_file_inputs', e.target.checked)}
          />
          Read file contents from paths
        </label>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          When enabled, any input port with data type 'File path' is automatically read from disk
          (text or base64) before this node runs.
        </p>
      </div>
    </>
  );
}
