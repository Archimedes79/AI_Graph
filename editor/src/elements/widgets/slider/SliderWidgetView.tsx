import type { WidgetViewProps } from '../WidgetView';
import { MUTED } from '@/ui/theme';
import { sliderRange } from '@engine/elements/widgets/slider/range.ts';

/** The keys that move a range input. Tabbing onto one is not using it. */
const MOVES = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** Runtime slider widget: a range input with its current number shown beside it. */
export default function SliderWidgetView({ widget, value, onChange, onTrigger, fires, busy }: WidgetViewProps) {
  // The range and the number are read by the engine's rule, the one a run
  // emits by: a value left from before the range was narrowed would otherwise
  // stand beside the handle while the graph is handed the edge of the range.
  // The page stores what the input reports, a string, which the rule reads as
  // the number it is rather than snapping the handle home after every drag.
  const { min, max, step, value: current } = sliderRange({ min: widget.min, max: widget.max, step: widget.step, value });

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        className="flex-1"
        min={min}
        max={max}
        step={step}
        value={current}
        // A slider that starts the graph waits for the round in flight, as a
        // button does: one let go of meanwhile was kept, and started nothing.
        disabled={busy === true && fires === true}
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
