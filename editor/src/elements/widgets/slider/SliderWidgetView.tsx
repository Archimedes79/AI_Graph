import type { WidgetViewProps } from '../WidgetView';
import { MUTED } from '@/ui/theme';

/** The keys that move a range input. Tabbing onto one is not using it. */
const MOVES = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** Runtime slider widget: a range input with its current number shown beside it. */
export default function SliderWidgetView({ widget, value, onChange, onTrigger }: WidgetViewProps) {
  const min = typeof widget.min === 'number' ? widget.min : 0;
  const max = typeof widget.max === 'number' && widget.max > min ? widget.max : min + 1;
  const step = typeof widget.step === 'number' && widget.step > 0 ? widget.step : 1;
  // The page stores what the input reports, which is a string; read it as the
  // number it is rather than falling back to the minimum and snapping the
  // handle home after every drag.
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  const current = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : min;

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
        // Dragging passes through every value on the way; the event is letting
        // go, or a run would start for each of them.
        onMouseUp={(e) => onTrigger?.((e.target as HTMLInputElement).value)}
        onTouchEnd={(e) => onTrigger?.((e.target as HTMLInputElement).value)}
        onKeyUp={(e) => { if (MOVES.has(e.key)) onTrigger?.((e.target as HTMLInputElement).value); }}
      />
      <span className="text-sm font-mono w-12 text-right" style={{ color: MUTED }}>{current}</span>
    </div>
  );
}
