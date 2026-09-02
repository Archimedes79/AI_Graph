import React from 'react';
import type { GuiWidget } from '@/types/graph';
import { DIM, FIELD_ON_SURFACE, MUTED } from '@/ui/theme';

interface Props {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
}

export default function SelectEditor({ widget, onUpdate }: Props) {
  const options = typeof widget.options === 'string' ? widget.options : '';

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Options — one per line
        </label>
        <textarea
          className="w-full rounded-lg px-2 py-1.5 text-sm font-mono"
          style={{ ...FIELD_ON_SURFACE, minHeight: 90 }}
          value={options}
          onChange={(e) => onUpdate({ options: e.target.value })}
          placeholder={'Small\nMedium\nLarge'}
        />
      </div>
      <p className="text-xs" style={{ color: DIM }}>
        Emits whichever option is selected on the page. The first line is the default.
      </p>
    </div>
  );
}
