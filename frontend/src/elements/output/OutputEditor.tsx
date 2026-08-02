import React from 'react';
import type { GraphNode } from '../../types/graph';

interface OutputEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
}

export default function OutputEditor({ node, setConfig }: OutputEditorProps) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
        Output Label
      </label>
      <input
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
        value={node.config.output_label}
        onChange={(e) => setConfig('output_label', e.target.value)}
      />

      <div className="mt-4 pt-4" style={{ borderTop: '1px solid #2d3148' }}>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          Write result to disk
        </label>
        <select
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={node.config.write_mode}
          onChange={(e) => setConfig('write_mode', e.target.value)}
        >
          <option value="none">Don't write to disk (show in Results panel only)</option>
          <option value="file">Write to a single file</option>
          <option value="directory">Write to a directory (one file per value)</option>
        </select>

        {node.config.write_mode !== 'none' && (
          <>
            <label className="block text-xs font-medium mb-1 mt-3" style={{ color: '#94a3b8' }}>
              {node.config.write_mode === 'file' ? 'Output file path' : 'Output directory path'}
            </label>
            <input
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
              value={node.config.value ?? ''}
              onChange={(e) => setConfig('value', e.target.value)}
              placeholder={node.config.write_mode === 'file' ? '/path/to/output.txt' : '/path/to/output-dir'}
              disabled={node.config.prompt_at_runtime}
            />
            <label className="flex items-center gap-2 mt-2 text-sm" style={{ color: '#94a3b8' }}>
              <input
                type="checkbox"
                checked={!!node.config.prompt_at_runtime}
                onChange={(e) => setConfig('prompt_at_runtime', e.target.checked)}
              />
              Ask for path when running (web, CLI, and deployed runs)
            </label>
          </>
        )}
      </div>
    </div>
  );
}
