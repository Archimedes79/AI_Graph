import PathField from '@/dialogs/PathField';
import { DIMMER, FIELD, MUTED } from '@/ui/theme';
import { OutputNodeRunner } from '@engine/elements/nodes/output/OutputNodeRunner.ts';
import type { NodePanelProps } from '../../NodeGuiBuilder';

const OUTPUT = new OutputNodeRunner();

/**
 * An output node: the run's result -- where it goes besides, and what it is.
 *
 * What it is and where it goes are what the node feeding it is told it wants
 * (`OutputNodeGuiBuilder.wantsOn`), so they are asked in those words. What the
 * result is called is what the node is called: the dialog's title. It had a
 * second name for that, and a window of its own in the editor; a page is
 * where a result is shown.
 */
export default function OutputNodePanel({ node, setConfig, fields }: NodePanelProps) {
  const mode = node.config.write_mode;
  const writes = mode === 'file' || mode === 'directory';

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Where the result goes</label>
        <select
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={FIELD}
          value={writes ? mode : 'none'}
          onChange={(e) => setConfig('write_mode', e.target.value)}
          aria-label="Where the result goes"
        >
          <option value="none">Into the run's result only</option>
          <option value="file">Into the run's result, and a file</option>
          <option value="directory">Into the run's result, and a folder: one file per value</option>
        </select>

        {writes && (
          <div className="mt-3">
            <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
              {mode === 'file' ? 'File' : 'Folder'}
            </label>
            {/* A file is saved, so 📂 Browse… starts with its name filled in; a folder is chosen as it is. */}
            <PathField
              mode={mode === 'file' ? 'save' : 'directory'}
              value={String(node.config.value ?? '')}
              onChange={(path) => setConfig('value', path)}
              placeholder={mode === 'file' ? 'output/result.txt' : 'output/results'}
              ariaLabel={mode === 'file' ? 'File' : 'Folder'}
            />
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
          The run's result calls it what this node is called: “{OUTPUT.resultLabel(node as never)}”.
        </p>
      </div>
    </div>
  );
}
