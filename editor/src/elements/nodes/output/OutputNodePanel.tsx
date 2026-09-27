import React from 'react';
import FileBrowserDialog from '@/dialogs/FileBrowserDialog';
import { DIMMER, FIELD, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';
import type { NodePanelProps } from '../../NodeGuiBuilder';

/**
 * How 📂 Browse… opens for where the result goes: a file is saved, so the
 * dialog starts in the file's folder with its name filled in -- choosing
 * another folder must not lose the name, which it did -- and a folder is
 * chosen as it is.
 */
export function browseFor(mode: string, value: string): { mode: 'save' | 'directory'; initialPath: string; defaultName?: string } {
  if (mode !== 'file') return { mode: 'directory', initialPath: value };
  const name = value.split(/[\\/]/).pop() ?? '';
  return { mode: 'save', initialPath: value, ...(name ? { defaultName: name } : {}) };
}

/**
 * An output node: where the result goes, what it is, and what it is called.
 *
 * What it is and where it goes are what the node feeding it is told it wants
 * (`OutputNodeGuiBuilder.wantsOn`), so they are asked first and in those
 * words; the name comes last, since it only labels what the first two say.
 */
export default function OutputNodePanel({ node, setConfig, fields }: NodePanelProps) {
  const mode = node.config.write_mode;
  const writes = mode === 'file' || mode === 'directory';
  const [browsing, setBrowsing] = React.useState(false);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Where the result goes</label>
        <select
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={FIELD}
          value={mode}
          onChange={(e) => setConfig('write_mode', e.target.value)}
          aria-label="Where the result goes"
        >
          <option value="none">Into the run's results only</option>
          <option value="window">Into a window of its own (and the results)</option>
          <option value="file">Into a file</option>
          <option value="directory">Into a folder, one file per value</option>
        </select>

        {writes && (
          <div className="mt-3">
            <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
              {mode === 'file' ? 'File' : 'Folder'}
            </label>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm"
                style={FIELD}
                value={node.config.value ?? ''}
                onChange={(e) => setConfig('value', e.target.value)}
                placeholder={mode === 'file' ? 'output/result.txt' : 'output/results'}
                aria-label={mode === 'file' ? 'File' : 'Folder'}
              />
              <button
                type="button"
                className="text-xs px-3 py-2 rounded-lg flex-shrink-0"
                style={NEUTRAL_BUTTON}
                onClick={() => setBrowsing(true)}
              >
                📂 Browse…
              </button>
            </div>
            {browsing && (
              <FileBrowserDialog
                {...browseFor(mode, String(node.config.value ?? ''))}
                onPick={(picked) => { setConfig('value', picked); setBrowsing(false); }}
                onClose={() => setBrowsing(false)}
              />
            )}
            <p className="text-xs mt-1" style={{ color: DIMMER }}>
              {mode === 'file'
                ? 'A text is written as it is, anything else as JSON.'
                : 'Each value that arrives becomes a file of its own in this folder.'}
              {' '}A path wired into the “Path” port is used instead.
            </p>
            <label className="flex items-center gap-2 mt-2 text-sm" style={{ color: MUTED }}>
              <input
                type="checkbox"
                checked={!!node.config.prompt_at_runtime}
                onChange={(e) => setConfig('prompt_at_runtime', e.target.checked)}
              />
              Ask for the path when running (web, CLI, and deployed runs)
            </label>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>What the result is</label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-y"
          style={{ ...FIELD, minHeight: 56 }}
          value={node.description}
          onChange={(e) => fields.set('description', e.target.value)}
          placeholder="e.g. one row per country, with its population"
          aria-label="What the result is"
        />
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          The node wired into this one is told this, and where the result goes, when ✨ writes it.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          {mode === 'window' ? 'Its name, and the window’s title' : 'Its name in the results'}
        </label>
        {/* A graph file that names nothing keys the result by the node's id
            (`whenMissing`), and the box is then empty: it says so, rather than
            look like a name that was lost. */}
        <input
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={FIELD}
          value={node.config.output_label ?? ''}
          onChange={(e) => setConfig('output_label', e.target.value)}
          placeholder={mode === 'window'
            ? `Empty: the node’s id, “${node.id}”, names the result, and its label titles the window`
            : `Empty: the node’s id, “${node.id}”, names the result`}
          aria-label="Name of the result"
        />
      </div>
    </div>
  );
}
