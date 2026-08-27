import React from 'react';
import type { GuiWidget } from '../../../../types/graph';
import { effectiveTextIoMode } from './mode';
import { DIM, FIELD_ON_SURFACE, MUTED } from '../../../../ui/theme';

interface Props {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
}

export default function TextIoEditor({ widget, onUpdate }: Props) {
  const mode = effectiveTextIoMode(widget);

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Mode
        </label>
        <select
          className="w-full rounded-lg px-2 py-1.5 text-sm"
          style={FIELD_ON_SURFACE}
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
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
            Default / Initial value
          </label>
          <textarea
            className="w-full rounded-lg px-2 py-1.5 text-sm font-mono"
            style={{ ...FIELD_ON_SURFACE, minHeight: 60 }}
            value={typeof widget.value === 'string' ? widget.value : ''}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder="Leave blank for no default…"
          />
        </div>
      )}

      {mode === 'output' && (
        <p className="text-xs" style={{ color: DIM }}>
          Output mode: this widget has only an <strong style={{ color: '#a78bfa' }}>input port</strong> and shows whatever the connected node produces.
        </p>
      )}
      {mode === 'input' && (
        <p className="text-xs" style={{ color: DIM }}>
          Input mode: this widget has only an <strong style={{ color: '#a78bfa' }}>output port</strong> carrying the user's typed text.
        </p>
      )}
    </div>
  );
}
