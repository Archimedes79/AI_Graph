import PathField, { FileTypesField } from '@/dialogs/PathField';
import SelectorSteps from '@/authoring/SelectorSteps';
import { FIELD_ON_SURFACE, MUTED } from '@/ui/theme';
import type { WidgetPanelProps } from '../../WidgetGuiBuilder';
import { InputPickerWidgetGuiBuilder } from './InputPickerWidgetGuiBuilder';

/**
 * A file or a folder, picked on the page. In directory mode it can choose
 * some of the folder's files by code, and then it is built in the four steps
 * an input node's folder is, drawn by the same component -- it is one
 * behaviour at two levels.
 */
export default function InputPickerWidgetPanel({
  builder, widget, fields, onUpdate, generating, message, onGenerate, steps,
}: WidgetPanelProps) {
  const generation = builder.generation;
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
      <PathField
        value={path}
        onChange={(picked) => onUpdate({ value: picked })}
        mode={directory ? 'directory' : 'file'}
        extensions={widget.extensions ?? ''}
        placeholder={directory ? '/path/to/directory' : '/path/to/file'}
        ariaLabel={directory ? 'Folder' : 'Default path'}
        onSurface
      />
    </div>
  );

  // Both modes. This sat inside the directory branch, so a picker set to one
  // file could not be told which kinds it accepts -- while the block itself
  // used the setting either way and the page printed "Allowed: .csv"
  // underneath it.
  const typesField = (
    <FileTypesField value={widget.extensions ?? ''} onChange={(extensions) => onUpdate({ extensions })} onSurface />
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
