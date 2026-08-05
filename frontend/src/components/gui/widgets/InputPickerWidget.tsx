import React, { useRef } from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { valueToText } from '../widgetProps';

/** Runtime input_picker widget: unified file or directory picker. */
export default function InputPickerWidget({ widget, value, onChange }: GuiWidgetRuntimeProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const isDir = widget.mode === 'directory';
  const displayVal = Array.isArray(value) ? `${value.length} file(s) selected` : valueToText(value);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fullPath = (file as File & { path?: string }).path;
    onChange(fullPath || file.name);
    e.target.value = '';
  };

  const hasValue = Array.isArray(value) ? value.length > 0 : !!value;

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2">
        <input
          className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-sm font-mono"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={Array.isArray(value) ? '' : valueToText(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isDir ? '/path/to/directory' : '/path/to/file'}
          readOnly={Array.isArray(value)}
        />
        <button
          onClick={() => pickerRef.current?.click()}
          className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
        >
          Browse…
        </button>
        {hasValue && (
          <button
            onClick={() => onChange('')}
            className="text-xs px-2 py-1.5 rounded-lg flex-shrink-0"
            style={{ background: '#2d3148', color: '#f87171' }}
            title="Clear selection"
          >
            ✕
          </button>
        )}
      </div>
      {Array.isArray(value) && (
        <span className="text-xs" style={{ color: '#94a3b8' }}>{displayVal}</span>
      )}
      {widget.extensions && !isDir && (
        <span className="text-xs" style={{ color: '#475569' }}>Allowed: {widget.extensions}</span>
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
