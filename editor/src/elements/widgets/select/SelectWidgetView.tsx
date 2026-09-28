import type { WidgetViewProps } from '../WidgetView';
import { FIELD } from '@/ui/theme';
import { widgetFiresRun } from '@/document/guiWidgets';
import { selectChoice, selectOptions } from '@engine/elements/widgets/select/choice.ts';

/** Runtime select widget: a dropdown over the block's own option list, standing where a run reads it. */
export default function SelectWidgetView({ widget, value, onChange, onTrigger, busy }: WidgetViewProps) {
  const options = selectOptions(widget.options);
  const current = selectChoice(options, value);

  return (
    <select
      className="w-full rounded-lg px-2 py-1.5 text-sm"
      style={FIELD}
      value={current}
      // A choice that starts the graph waits for the round in flight, as a
      // button does: one made meanwhile was kept, and started nothing.
      disabled={busy === true && widgetFiresRun(widget)}
      // A choice is made in one gesture, so the change is also the event.
      onChange={(e) => { onChange(e.target.value); onTrigger?.(e.target.value); }}
    >
      {options.length === 0 && <option value="">No options yet</option>}
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}
