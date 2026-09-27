import { useState } from 'react';
import FileBrowserDialog from '@/dialogs/FileBrowserDialog';
import SelectorSteps from '@/authoring/SelectorSteps';
import { FIELD_ON_SURFACE, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';
import type { WidgetPanelProps } from '../../WidgetGuiBuilder';
import { InputPickerWidgetGuiBuilder } from './InputPickerWidgetGuiBuilder';

/**
 * A file or a folder, picked on the page. In directory mode it can choose
 * some of the folder's files by code, and then it is built in the four steps
 * an input node's folder is, drawn by the same component -- it is one
 * behaviour at two levels.
 */
export default function InputPickerWidgetPanel({
  builder, widget, generation, fields, onUpdate, generating, message, onGenerate, steps,
}: WidgetPanelProps) {
  const [browsing, setBrowsing] = useState(false);
  if (!(builder instanceof InputPickerWidgetGuiBuilder)) return null;
  const mode = widget.mode || 'file';
  const directory = mode === 'directory';
  const path = typeof widget.value === 'string' ? widget.value : '';

  const modeField = (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Mode</label>
      <select
        className="w-full rounded-lg px-2 py-1.5 text-sm"
        style={FIELD_ON_SURFACE}
        value={mode}
        onChange={(e) => onUpdate({ mode: e.target.value })}
      >
        <option value="file">Single file</option>
        <option value="directory">Directory (list of files)</option>
      </select>
    </div>
  );

  const pathField = (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
        {directory ? 'Folder' : 'Default path'}
      </label>
      <div className="flex items-center gap-2">
        <input
          className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-sm"
          style={FIELD_ON_SURFACE}
          value={path}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder={directory ? '/path/to/directory' : '/path/to/file'}
          aria-label={directory ? 'Folder' : 'Default path'}
        />
        <button type="button" className="text-xs px-2 py-1.5 rounded-lg flex-shrink-0" style={NEUTRAL_BUTTON} onClick={() => setBrowsing(true)}>
          📂 Browse…
        </button>
      </div>
      {browsing && (
        <FileBrowserDialog
          mode={directory ? 'directory' : 'file'}
          initialPath={path}
          extensions={widget.extensions ?? ''}
          onPick={(picked) => { onUpdate({ value: picked }); setBrowsing(false); }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );

  // Both modes. This sat inside the directory branch, so a picker set to one
  // file could not be told which kinds it accepts -- while the block itself
  // used the setting either way and the page printed "Allowed: .csv"
  // underneath it.
  const typesField = (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
        File types (e.g. .md, .txt)
      </label>
      <input
        className="w-full rounded-lg px-2 py-1.5 text-sm"
        style={FIELD_ON_SURFACE}
        value={widget.extensions ?? ''}
        onChange={(e) => onUpdate({ extensions: e.target.value })}
        placeholder="Leave empty for all file types"
      />
    </div>
  );

  if (!directory || !generation || !steps) {
    return <div className="space-y-2">{modeField}{pathField}{typesField}</div>;
  }

  return (
    <div className="space-y-2">
      {modeField}
      <SelectorSteps
        folder={(
          <div className="space-y-2">
            {pathField}
            {typesField}
            <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
              <input
                type="checkbox"
                checked={widget.recursive === true}
                onChange={(e) => onUpdate({ recursive: e.target.checked })}
              />
              Look into subfolders too
            </label>
          </div>
        )}
        noFolder={!path.trim()}
        // As a run reads it: a picker that does not say takes every file.
        selectAll={builder.selectsAll(widget)}
        onSelectAll={(all) => onUpdate({ select_all_files: all })}
        generation={generation}
        subject={widget}
        fields={fields}
        generating={generating}
        message={message}
        onGenerate={onGenerate}
        tryIt={() => steps.tryIt({})}
        preview={steps.preview}
        sent={steps.sent}
        openInEditor={steps.openInEditor}
        onSurface
      />
    </div>
  );
}
