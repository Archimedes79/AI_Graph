import React from 'react';
import type { GuiWidget } from '../../../types/graph';

interface FileOpenEditorProps {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
}

export default function FileOpenEditor({ widget, onUpdate }: FileOpenEditorProps) {
  return (
    <div className="mb-2">
      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
        Default path
      </label>
      <input
        className="w-full rounded-lg px-2 py-1.5 text-sm"
        style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
        value={widget.value ?? ''}
        onChange={(e) => onUpdate({ value: e.target.value })}
        placeholder="/path/to/file"
      />
    </div>
  );
}
