import React from 'react';
import type { GuiWidget } from '../../../types/graph';

interface InputPickerEditorProps {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
}

export default function InputPickerEditor({ widget, onUpdate }: InputPickerEditorProps) {
  const mode = widget.mode || 'file';
  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>Mode</label>
        <select
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={mode}
          onChange={(e) => onUpdate({ mode: e.target.value })}
        >
          <option value="file">Single file</option>
          <option value="directory">Directory (list of files)</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          Default path
        </label>
        <input
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={widget.value ?? ''}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder={mode === 'directory' ? '/path/to/directory' : '/path/to/file'}
        />
      </div>
      {mode === 'directory' && (
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
            File types (e.g. .md, .txt)
          </label>
          <input
            className="w-full rounded-lg px-2 py-1.5 text-sm"
            style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
            value={widget.extensions ?? ''}
            onChange={(e) => onUpdate({ extensions: e.target.value })}
            placeholder="Leave empty for all file types"
          />
        </div>
      )}
    </div>
  );
}
