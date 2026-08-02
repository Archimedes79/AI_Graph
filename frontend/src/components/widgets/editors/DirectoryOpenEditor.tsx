import React from 'react';
import type { GuiWidget } from '../../../types/graph';

interface DirectoryOpenEditorProps {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
}

export default function DirectoryOpenEditor({ widget, onUpdate }: DirectoryOpenEditorProps) {
  return (
    <>
      <div className="mb-2">
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          Default path
        </label>
        <input
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={widget.value ?? ''}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder="/path/to/directory"
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          Extensions filter (comma-separated, e.g. .md, .txt)
        </label>
        <input
          className="w-full rounded-lg px-2 py-1.5 text-sm font-mono"
          style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={widget.extensions}
          onChange={(e) => onUpdate({ extensions: e.target.value })}
          placeholder="Leave empty for all file types"
        />
      </div>
    </>
  );
}
