import type { GuiWidget } from '@/graph';
import { FIELD_ON_SURFACE, MUTED } from '@/ui/theme';
import type { WidgetPanelProps } from '../../WidgetGuiBuilder';
import { sliderRange } from '@engine/elements/widgets/slider/range.ts';

export default function SliderWidgetPanel({ widget, onUpdate }: WidgetPanelProps) {
  // The fields show what the run uses: an emptied Max reads as the engine's
  // default, not a number of the panel's own.
  const shown = sliderRange({ min: widget.min, max: widget.max, step: widget.step });
  const typed = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

  return (
    <div className="grid grid-cols-3 gap-2">
      {([['min', 'Min'], ['max', 'Max'], ['step', 'Step']] as const).map(([field, label]) => (
        <label key={field} className="block">
          <span className="block text-xs font-medium mb-1" style={{ color: MUTED }}>{label}</span>
          <input
            type="number"
            className="w-full rounded-lg px-2 py-1.5 text-sm"
            style={FIELD_ON_SURFACE}
            value={typed(widget[field], shown[field])}
            onChange={(e) => onUpdate({ [field]: e.target.value === '' ? undefined : Number(e.target.value) } as Partial<GuiWidget>)}
          />
        </label>
      ))}
    </div>
  );
}
