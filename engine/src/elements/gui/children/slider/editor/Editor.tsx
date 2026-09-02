import React from 'react';
import type { GuiWidget } from '@/types/graph';
import { FIELD_ON_SURFACE, MUTED } from '@/ui/theme';

interface Props {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
}

export default function SliderEditor({ widget, onUpdate }: Props) {
  const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

  return (
    <div className="grid grid-cols-3 gap-2">
      {([['min', 'Min', 0], ['max', 'Max', 100], ['step', 'Step', 1]] as const).map(([field, label, fallback]) => (
        <div key={field}>
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>{label}</label>
          <input
            type="number"
            className="w-full rounded-lg px-2 py-1.5 text-sm"
            style={FIELD_ON_SURFACE}
            value={num(widget[field], fallback)}
            onChange={(e) => onUpdate({ [field]: e.target.value === '' ? undefined : Number(e.target.value) } as Partial<GuiWidget>)}
          />
        </div>
      ))}
    </div>
  );
}
