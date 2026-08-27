import React from 'react';
import type { GraphNode } from '../../types/graph';
import { DIMMER, FIELD, LINE, MUTED } from '../../ui/theme';

interface OutputEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
}

export default function OutputEditor({ node, setConfig }: OutputEditorProps) {
  const mode = node.config.write_mode;

  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
        {mode === 'window' ? 'Window Title' : 'Output Label'}
      </label>
      <input
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={FIELD}
        value={node.config.output_label}
        onChange={(e) => setConfig('output_label', e.target.value)}
      />

      <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${LINE}` }}>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Write result to disk
        </label>
        <select
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={FIELD}
          value={node.config.write_mode}
          onChange={(e) => setConfig('write_mode', e.target.value)}
        >
          <option value="none">Don't write to disk (show in Results panel only)</option>
          <option value="window">Show in a text window (also visible in Results panel)</option>
          <option value="file">Write to a single file</option>
          <option value="directory">Write to a directory (one file per value)</option>
        </select>

        {(mode === 'file' || mode === 'directory') && (
          <>
            <label className="block text-xs font-medium mb-1 mt-3" style={{ color: MUTED }}>
              {mode === 'file' ? 'Default output file path' : 'Default output directory path'}
            </label>
            <input
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={FIELD}
              value={node.config.value ?? ''}
              onChange={(e) => setConfig('value', e.target.value)}
              placeholder={mode === 'file' ? '/path/to/output.txt' : '/path/to/output-dir'}
              disabled={node.config.prompt_at_runtime}
            />
            <p className="text-xs mt-1" style={{ color: DIMMER }}>
              Wire a value into this node's "Path" input port to set the {mode === 'file' ? 'file' : 'directory'} path
              from elsewhere in the graph instead — it overrides the default above whenever connected.
            </p>
            <label className="flex items-center gap-2 mt-2 text-sm" style={{ color: MUTED }}>
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
