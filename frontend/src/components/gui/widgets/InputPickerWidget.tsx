import React, { useRef } from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { valueToText } from '../widgetProps';
import { DANGER_SOFT, DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON } from '../../../ui/theme';

/** Runtime input_picker widget: unified file or directory picker. */
export default function InputPickerWidget({ widget, value, onChange }: GuiWidgetRuntimeProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const isDir = widget.mode === 'directory';
  const displayVal = Array.isArray(value) ? `${value.length} file(s) selected` : valueToText(value);

  const [pickWarning, setPickWarning] = React.useState('');

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // `File.path` is an Electron extension; a browser never exposes the real
    // location. Writing `file.name` instead used to look like it worked and
    // then failed server-side with a file-not-found from the working
    // directory -- say so instead, since the engine resolves a real path.
    const fullPath = (file as File & { path?: string }).path;
    if (!fullPath) {
      setPickWarning(`The browser only reveals the name "${file.name}", not its location. Type or paste the full path instead.`);
      return;
    }
    setPickWarning('');
    onChange(fullPath);
  };

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
          onClick={() => pickerRef.current?.click()}
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
      {pickWarning && (
        <span className="text-xs" style={{ color: '#fbbf24' }}>{pickWarning}</span>
      )}
      {widget.extensions && !isDir && (
        <span className="text-xs" style={{ color: DIMMER }}>Allowed: {widget.extensions}</span>
      )}
      <input
        ref={pickerRef}
        type="file"
        className="hidden"
        accept={widget.extensions || undefined}
        onChange={handlePick}
      />
    </div>
  );
}
