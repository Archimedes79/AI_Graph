import React, { useState } from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { valueToText } from '../widgetProps';
import FileBrowserDialog from '../../FileBrowserDialog';
import { DANGER_SOFT, DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON } from '../../../ui/theme';

/** Runtime input_picker widget: unified file or directory picker. */
export default function InputPickerWidget({ widget, value, onChange }: GuiWidgetRuntimeProps) {
  const isDir = widget.mode === 'directory';
  const displayVal = Array.isArray(value) ? `${value.length} file(s) selected` : valueToText(value);

  // Browses the machine the graph runs on. A native `<input type="file">` used
  // to be wired up here, but a browser only ever exposes a chosen file's name,
  // never its location -- so it could not produce a path the engine resolves.
  const [browsing, setBrowsing] = useState(false);

  const hasValue = Array.isArray(value) ? value.length > 0 : !!value;

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2">
        <input
          className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-sm font-mono"
          style={FIELD}
          value={Array.isArray(value) ? '' : valueToText(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isDir ? '/path/to/directory' : '/path/to/file'}
          readOnly={Array.isArray(value)}
        />
        <button
          onClick={() => setBrowsing(true)}
          className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0"
          style={NEUTRAL_BUTTON}
        >
          Browse…
        </button>
        {hasValue && (
          <button
            onClick={() => onChange('')}
            className="text-xs px-2 py-1.5 rounded-lg flex-shrink-0"
            style={{ background: LINE, color: DANGER_SOFT }}
            title="Clear selection"
            aria-label={`Clear ${widget.label || widget.id}`}
          >
            ✕
          </button>
        )}
      </div>
      {Array.isArray(value) && (
        <span className="text-xs" style={{ color: MUTED }}>{displayVal}</span>
      )}
      {widget.extensions && !isDir && (
        <span className="text-xs" style={{ color: DIMMER }}>Allowed: {widget.extensions}</span>
      )}
      {browsing && (
        <FileBrowserDialog
          mode={isDir ? 'directory' : 'file'}
          initialPath={Array.isArray(value) ? '' : valueToText(value)}
          extensions={widget.extensions || ''}
          onPick={(picked) => { onChange(picked); setBrowsing(false); }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}
