import React, { useRef } from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { valueToText } from '../widgetProps';

/** Runtime `file_open` widget: a path field plus a native picker. */
export default function FileOpenWidget({ widget, value, onChange }: GuiWidgetRuntimeProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const path = valueToText(value);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Browsers only expose the bare file name; desktop shells (Electron/Tauri)
    // add a real `path`, which is what the backend actually needs.
    const fullPath = (file as File & { path?: string }).path;
    onChange(fullPath || file.name);
    e.target.value = '';
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2">
        <input
          className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-sm font-mono"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={path}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/path/to/file"
        />
        <button
          onClick={() => pickerRef.current?.click()}
          className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
        >
          Browse…
        </button>
      </div>
      {widget.extensions && (
        <span className="text-xs" style={{ color: '#475569' }}>
          Allowed: {widget.extensions}
        </span>
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
