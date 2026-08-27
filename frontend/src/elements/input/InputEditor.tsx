import React from 'react';
import type { GraphNode } from '../../types/graph';
import ContextFileAttachment from '../shared/ContextFileAttachment';
import FileBrowserDialog from '../../components/FileBrowserDialog';
import { DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON, SUCCESS } from '../../ui/theme';

interface InputEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  generating: boolean;
  handleGenerateSelectorCode: () => void;
  applyMode?: (mode: 'text' | 'file' | 'directory') => void;
  contextFile: string;
  onContextFileChange: (path: string) => void;
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
  contextFile,
  onContextFileChange,
}: InputEditorProps) {
  const mode: 'text' | 'file' | 'directory' =
    (node.config.input_mode || 'text') as 'text' | 'file' | 'directory';

  const [browsing, setBrowsing] = React.useState(false);

  const isText = mode === 'text';
  const isFile = mode === 'file';
  const isDirectory = mode === 'directory';

  return (
    <div>
      {/* Mode selector */}
      <div className="mb-4">
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Mode</label>
          <select
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={FIELD}
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
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          {isText ? 'Default Text (shown in the run dialog)' : 'Default Path (shown in the run dialog)'}
        </label>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm"
            style={FIELD}
            value={node.config.value ?? ''}
            onChange={(e) => setConfig('value', e.target.value)}
            placeholder={isText ? 'Enter default text…' : isDirectory ? '/path/to/directory' : '/path/to/file'}
          />
          {!isText && (
            <button
              type="button"
              className="text-xs px-3 py-2 rounded-lg flex-shrink-0"
              style={NEUTRAL_BUTTON}
              onClick={() => setBrowsing(true)}
            >
              Browse…
            </button>
          )}
        </div>
        {browsing && (
          <FileBrowserDialog
            mode={isDirectory ? 'directory' : 'file'}
            initialPath={(node.config.value as string) ?? ''}
            extensions={(node.config.extra?.extensions as string) ?? ''}
            onPick={(picked) => { setConfig('value', picked); setBrowsing(false); }}
            onClose={() => setBrowsing(false)}
          />
        )}
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Whenever the graph runs, a dialog asks the user for this value (pre-filled with the default above).
        </p>
      </div>

      {/* Directory-specific options */}
      {isDirectory && (
        <>
          <label className="flex items-center gap-2 mb-2 text-sm" style={{ color: MUTED }}>
            <input
              type="checkbox"
              checked={!!node.config.extra?.recursive}
              onChange={(e) => setConfig('extra', { ...node.config.extra, recursive: e.target.checked })}
            />
            Recursive
          </label>
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
              File types (comma-separated, e.g. .md, .txt)
            </label>
            <input
              className="w-full rounded-lg px-3 py-2 text-sm font-mono"
              style={FIELD}
              value={(node.config.extra?.extensions as string) ?? ''}
              onChange={(e) => setConfig('extra', { ...node.config.extra, extensions: e.target.value })}
              placeholder="Leave empty for all file types"
            />
          </div>
        </>
      )}

      {/* AI file selector — directory mode */}
      {isDirectory && (
        <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${LINE}` }}>
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
            Prompt text
          </label>
          <textarea
            className="w-full rounded-lg px-3 py-2 text-sm resize-none"
            style={{ ...FIELD, minHeight: 80 }}
            value={node.config.selector_prompt}
            onChange={(e) => setConfig('selector_prompt', e.target.value)}
            placeholder="Select Markdown files that contain API documentation"
          />
          <div className="mt-3">
            <ContextFileAttachment
              label="Additional data (optional context file)"
              path={contextFile}
              onChange={onContextFileChange}
            />
          </div>
          <div className="mt-3 mb-2">
            <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
              Language selection
            </label>
            <select
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={FIELD}
              value={node.config.language || 'python'}
              onChange={(e) => setConfig('language', e.target.value)}
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm mb-2" style={{ color: MUTED }}>
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
                <label className="text-xs font-medium" style={{ color: MUTED }}>
                  Code window (editable) — run(inputs) receives {'{'}"files"{'}'} and must return {'{'}"files"{'}'}
                </label>
                <button
                  onClick={handleGenerateSelectorCode}
                  disabled={generating}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: SUCCESS, color: 'white', opacity: generating ? 0.5 : 1 }}
                >
                  {generating ? '…' : '✨ Generate'}
                </button>
              </div>
              <textarea
                className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
                style={{ ...FIELD, minHeight: 140 }}
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
