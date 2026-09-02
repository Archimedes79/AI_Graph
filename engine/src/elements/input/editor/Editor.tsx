import React from 'react';
import type { GraphNode } from '@/types/graph';
import FileBrowserDialog from '@/components/FileBrowserDialog';
import AuthoredBodyEditor from '@/elements/shared/AuthoredBodyEditor';
import ContextFileAttachment from '@/elements/shared/ContextFileAttachment';
import type { ElementGeneration, FieldAccess } from '@/elements/shared/generation';
import { DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

interface InputEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  generation: ElementGeneration<GraphNode>;
  fields: FieldAccess;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  applyMode?: (mode: 'text' | 'file' | 'directory') => void;
  contextFile: string;
  onContextFileChange: (path: string) => void;
}

export default function InputEditor({
  node, setConfig, generation, fields, generating, message, onGenerate,
  applyMode, contextFile, onContextFileChange,
}: InputEditorProps) {
  const mode: 'text' | 'file' | 'directory' =
    (node.config.input_mode || 'text') as 'text' | 'file' | 'directory';

  const [browsing, setBrowsing] = React.useState(false);

  const isText = mode === 'text';
  const isDirectory = mode === 'directory';

  return (
    <div>
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

      {/* A file input is the head of the chain: nothing upstream describes its
          data, so whatever is said here is all the generator downstream has. An
          attached sample is the strong form of that (the model sees the real
          thing); the sentence below is the weak form, for when no sample can be
          handed over. Without either, every node after this one is written
          against a guess. */}
      {!isText && (
        <div className="mb-4 space-y-3">
          {!isDirectory && (
            <ContextFileAttachment
              label="Example file (what a run will actually read)"
              path={contextFile}
              onChange={onContextFileChange}
            />
          )}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
              What these files contain — read by every node downstream
            </label>
            <textarea
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={FIELD}
              rows={2}
              value={node.config.output_format_prompt ?? ''}
              onChange={(e) => {
                setConfig('output_format_prompt', e.target.value);
                // The contract is only read when the node says it has one.
                setConfig('output_format', e.target.value.trim() ? 'custom' : 'text');
              }}
              placeholder="e.g. UTF-8 CSV, columns: date, amount, description"
            />
          </div>
        </div>
      )}

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
            extensions={node.config.extensions ?? ''}
            onPick={(picked) => { setConfig('value', picked); setBrowsing(false); }}
            onClose={() => setBrowsing(false)}
          />
        )}
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Whenever the graph runs, a dialog asks the user for this value (pre-filled with the default above).
        </p>
      </div>

      {isDirectory && (
        <>
          <label className="flex items-center gap-2 mb-2 text-sm" style={{ color: MUTED }}>
            <input
              type="checkbox"
              checked={!!node.config.recursive}
              onChange={(e) => setConfig('recursive', e.target.checked)}
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
              value={node.config.extensions ?? ''}
              onChange={(e) => setConfig('extensions', e.target.value)}
              placeholder="Leave empty for all file types"
            />
          </div>

          {/* The file selector: the same authored snippet an input_picker widget
              keeps, drawn by the same component. */}
          <div className="mt-4 pt-4 space-y-3" style={{ borderTop: `1px solid ${LINE}` }}>
            <AuthoredBodyEditor
              generation={generation}
              fields={fields}
              exampleFile={contextFile}
              onExampleFileChange={onContextFileChange}
              generating={generating}
              message={message}
              onGenerate={onGenerate}
              bodyHidden={node.config.select_all_files}
            >
              <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
                <input
                  type="checkbox"
                  checked={node.config.select_all_files}
                  onChange={(e) => setConfig('select_all_files', e.target.checked)}
                />
                Select all files
              </label>
            </AuthoredBodyEditor>
          </div>
        </>
      )}
    </div>
  );
}
