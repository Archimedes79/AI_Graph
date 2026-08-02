import React from 'react';
import type { GuiWidget } from '../../../../types/graph';

interface Props {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
}

export default function TextIoEditor({ widget, onUpdate }: Props) {
  const mode = widget.mode && ['input', 'output', 'both'].includes(widget.mode) ? widget.mode : 'both';

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          Mode
        </label>
        <select
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={mode}
          onChange={(e) => onUpdate({ mode: e.target.value })}
        >
          <option value="input">Input — user types text (drives graph)</option>
          <option value="output">Output — displays incoming value (read-only)</option>
          <option value="both">Both — user types outgoing text, displays incoming</option>
        </select>
      </div>

      {mode !== 'output' && (
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
            Default / Initial value
          </label>
          <textarea
            className="w-full rounded-lg px-2 py-1.5 text-sm font-mono"
            style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 60 }}
            value={widget.value ?? ''}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder="Leave blank for no default…"
          />
        </div>
      )}

      {mode === 'output' && (
        <p className="text-xs" style={{ color: '#64748b' }}>
          Output mode: this widget has only an <strong style={{ color: '#a78bfa' }}>input port</strong> and shows whatever the connected node produces.
        </p>
      )}
      {mode === 'input' && (
        <p className="text-xs" style={{ color: '#64748b' }}>
          Input mode: this widget has only an <strong style={{ color: '#a78bfa' }}>output port</strong> carrying the user's typed text.
        </p>
      )}
    </div>
  );
}
