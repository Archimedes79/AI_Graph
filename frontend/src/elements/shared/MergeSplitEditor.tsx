import React from 'react';
import type { GraphNode } from '../../types/graph';

interface MergeSplitEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
}

export default function MergeSplitEditor({ node, setConfig }: MergeSplitEditorProps) {
  const nt = node.node_type;
  return (
    <div>
      {nt === 'merge' && (
        <div className="mb-3">
          <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
            Merge mode
          </label>
          <select
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
            value={node.config.merge_mode}
            onChange={(e) => setConfig('merge_mode', e.target.value)}
          >
            <option value="concat">Concatenate text (default)</option>
            <option value="sum">Sum numbers</option>
            <option value="count">Count values</option>
            <option value="json_list">JSON list</option>
          </select>
        </div>
      )}
      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
        Separator
      </label>
      <input
        className="w-full rounded-lg px-3 py-2 text-sm font-mono"
        style={
          nt === 'merge' && node.config.merge_mode !== 'concat'
            ? { background: '#0f1117', color: '#475569', border: '1px solid #2d3148', opacity: 0.5 }
            : { background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }
        }
        value={node.config.separator}
        onChange={(e) => setConfig('separator', e.target.value)}
        placeholder="\n"
        disabled={nt === 'merge' && node.config.merge_mode !== 'concat'}
      />
      {nt === 'merge' && node.config.merge_mode !== 'concat' && (
        <p className="text-xs mt-1" style={{ color: '#475569' }}>
          Separator is unused in this merge mode.
        </p>
      )}
    </div>
  );
}
