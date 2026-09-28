import { useId } from 'react';
import PathField, { FileTypesField } from '@/dialogs/PathField';
import { listBlockAsRun } from '@/authoring/readAsRun';
import { FIELD_ON_SURFACE, MUTED } from '@/ui/theme';
import FolderListing from '../../fields/FolderListing';
import type { WidgetPanelProps } from '../../WidgetGuiBuilder';

/**
 * A file or a folder, picked on the page. A folder is its file types and its
 * subfolders, then the list -- the listing an input node's folder is, drawn by
 * the same component: it is one behaviour at two levels.
 */
export default function InputPickerWidgetPanel({ widget, onUpdate }: WidgetPanelProps) {
  const mode = widget.mode || 'file';
  const directory = mode === 'directory';
  const path = typeof widget.value === 'string' ? widget.value : '';
  const id = useId();

  const modeField = (
    <div>
      <label htmlFor={`${id}-mode`} className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Mode</label>
      <select
        id={`${id}-mode`}
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
      <label htmlFor={`${id}-path`} className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
        {directory ? 'Folder' : 'Default path'}
      </label>
      <PathField
        id={`${id}-path`}
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

  const listing = directory && (
    <FolderListing
      recursive={widget.recursive === true}
      onRecursive={(recursive) => onUpdate({ recursive })}
      noFolder={!path.trim()}
      list={() => listBlockAsRun(widget)}
      of={JSON.stringify([path, widget.extensions ?? '', widget.recursive === true])}
    />
  );

  return <div className="space-y-2">{modeField}{pathField}{typesField}{listing}</div>;
}
