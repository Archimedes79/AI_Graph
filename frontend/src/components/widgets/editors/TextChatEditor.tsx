import React from 'react';
import type { GuiWidget } from '../../../types/graph';

interface TextChatEditorProps {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
}

export default function TextChatEditor({ widget, onUpdate }: TextChatEditorProps) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
        {widget.kind === 'text_window' ? 'Default text' : 'Simulated message (for preview)'}
      </label>
      <textarea
        className="w-full rounded-lg px-2 py-1.5 text-sm resize-none"
        style={{ background: '#1a1d2e', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 60 }}
        value={widget.value ?? ''}
        onChange={(e) => onUpdate({ value: e.target.value })}
      />
    </div>
  );
}
