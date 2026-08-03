import React from 'react';
import type { GraphNode } from '../../types/graph';

interface InputEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  generating: boolean;
  handleGenerateSelectorCode: () => void;
  applyMode?: (mode: 'text' | 'file' | 'directory') => void;
}

const PARSE_FORMATS = [
  { value: 'text',     label: 'Text (raw)' },
  { value: 'json',     label: 'JSON' },
  { value: 'csv',      label: 'CSV (rows as dicts)' },
  { value: 'csv_list', label: 'CSV (rows as lists)' },
  { value: 'custom',   label: 'Custom (code)' },
];

export default function InputEditor({
  node,
  setConfig,
  generating,
  handleGenerateSelectorCode,
  applyMode,
}: InputEditorProps) {
  const mode: 'text' | 'file' | 'directory' =
    (node.config.input_mode || 'text') as 'text' | 'file' | 'directory';

  const isText = mode === 'text';
  const isFile = mode === 'file';
  const isDirectory = mode === 'directory';

  return (
    <div>
      {/* Mode selector */}
      <div className="mb-4">
          <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Mode</label>
          <select
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
            value={mode}
            onChange={(e) => {
              const next = e.target.value as 'text' | 'file' | 'directory';
              setConfig('input_mode', next);
              applyMode?.(next);
            }}
          >
            <option value="text">Text (static value)</option>
            <option value="file">Single file (read content)</option>
            <option value="directory">Directory (list of files)</option>
          </select>
        </div>

      {/* Default value / path */}
      <div className="mb-4">
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          {isText ? 'Default Text (shown in the run dialog)' : 'Default Path (shown in the run dialog)'}
        </label>
        <input
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={node.config.value ?? ''}
          onChange={(e) => setConfig('value', e.target.value)}
          placeholder={isText ? 'Enter default text…' : isDirectory ? '/path/to/directory' : '/path/to/file'}
        />
        <p className="text-xs mt-1" style={{ color: '#475569' }}>
          Whenever the graph runs, a dialog asks the user for this value (pre-filled with the default above).
        </p>
      </div>

      {/* Directory-specific options */}
      {isDirectory && (
        <>
          <label className="flex items-center gap-2 mb-2 text-sm" style={{ color: '#94a3b8' }}>
            <input
              type="checkbox"
              checked={!!node.config.extra?.recursive}
              onChange={(e) => setConfig('extra', { ...node.config.extra, recursive: e.target.checked })}
            />
            Recursive
          </label>
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
              File types (comma-separated, e.g. .md, .txt)
            </label>
            <input
              className="w-full rounded-lg px-3 py-2 text-sm font-mono"
              style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
              value={(node.config.extra?.extensions as string) ?? ''}
              onChange={(e) => setConfig('extra', { ...node.config.extra, extensions: e.target.value })}
              placeholder="Leave empty for all file types"
            />
          </div>
        </>
      )}

      {/* AI file selector — directory mode */}
      {isDirectory && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid #2d3148' }}>
          <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
            AI file-selection prompt
          </label>
          <textarea
            className="w-full rounded-lg px-3 py-2 text-sm resize-none"
            style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 80 }}
            value={node.config.selector_prompt}
            onChange={(e) => setConfig('selector_prompt', e.target.value)}
            placeholder="Select Markdown files that contain API documentation"
          />
          <label className="flex items-center gap-2 text-sm mb-2" style={{ color: '#94a3b8' }}>
            <input
              type="checkbox"
              checked={node.config.select_all_files}
              onChange={(e) => setConfig('select_all_files', e.target.checked)}
            />
            Select all files
          </label>
          {!node.config.select_all_files && (
            <>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>
                  File Selector Code — run(inputs) receives {'{'}"files"{'}'} and must return {'{'}"files"{'}'}
                </label>
                <button
                  onClick={handleGenerateSelectorCode}
                  disabled={generating}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: '#22c55e', color: 'white', opacity: generating ? 0.5 : 1 }}
                >
                  {generating ? '…' : '✨ Generate'}
                </button>
              </div>
              <textarea
                className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
                style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 140 }}
                value={node.config.selector_code}
                onChange={(e) => setConfig('selector_code', e.target.value)}
                spellCheck={false}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
