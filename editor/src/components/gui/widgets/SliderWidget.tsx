import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { MUTED } from '../../../ui/theme';

/** Runtime slider widget: a range input with its current number shown beside it. */
export default function SliderWidget({ widget, value, onChange }: GuiWidgetRuntimeProps) {
  const min = typeof widget.min === 'number' ? widget.min : 0;
  const max = typeof widget.max === 'number' && widget.max > min ? widget.max : min + 1;
  const step = typeof widget.step === 'number' && widget.step > 0 ? widget.step : 1;
  const current = typeof value === 'number' && Number.isFinite(value) ? value : min;

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        className="flex-1"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-sm font-mono w-12 text-right" style={{ color: MUTED }}>{current}</span>
    </div>
  );
}
