import type { GuiWidget, Port } from '@/types/graph';
import type { GuiWidgetElementDefinition } from '@/elements/types';
import TextIoWidget from '@/components/gui/widgets/TextIoWidget';
import TextIoEditor from './Editor';
import { effectiveTextIoMode } from './mode';

export const textIoElement: GuiWidgetElementDefinition = {
  widgetKind: 'text_io',
  ConfigEditor: TextIoEditor,
  RuntimeWidget: TextIoWidget,
  // A box that sends on Enter holds a message, and a message is said once:
  // clear it when a run has delivered it, so the box is ready for the next
  // one. A box that does not send holds a setting -- a search term, a name --
  // and emptying that after every run would make the person retype it.
  clearValueAfterRun: (widget) => effectiveTextIoMode(widget) !== 'output' && widget.run_on_change === true,
};
