// What a block is, to the page: the half of a widget that is delivered.
//
// A widget has three roles and they belong in three places. The engine's
// `WidgetElement` is what it contributes to a *run* -- a picker produces its
// path, a chat its message, a transform its value. `WidgetUi` is what the
// builder needs: a settings panel, a ✨ button, what the palette drops. And
// this is the third: what the person using the finished tool looks at and
// operates.
//
// Only this one is delivered, so only this one may be reachable from
// `runtime/main.tsx`. It used to live on `WidgetUi` beside the panel and the
// generation contract, and the page reached all of it through one registry --
// which is how the instructions for having an AI write a chart ended up inside
// the tool handed to someone who will never write one. `runtime/boundary.test.ts`
// now asserts that the roster next door is out of reach.

import type { ComponentType } from 'react';
import type { WidgetKind } from '@/graph';
import type { WidgetViewProps } from '@/elements/widgets/WidgetView';

import ButtonWidgetView from '@/elements/widgets/button/ButtonWidgetView';
import ChatWidgetView from '@/elements/widgets/chat/ChatWidgetView';
import DividerWidgetView from '@/elements/widgets/divider/DividerWidgetView';
import ImageViewWidgetView from '@/elements/widgets/image_view/ImageViewWidgetView';
import InputPickerWidgetView from '@/elements/widgets/input_picker/InputPickerWidgetView';
import PlotWindowWidgetView from '@/elements/widgets/plot_window/PlotWindowWidgetView';
import SelectWidgetView from '@/elements/widgets/select/SelectWidgetView';
import SliderWidgetView from '@/elements/widgets/slider/SliderWidgetView';
import SpacerWidgetView from '@/elements/widgets/spacer/SpacerWidgetView';
import TableWidgetView from '@/elements/widgets/table/TableWidgetView';
import TextWidgetView from '@/elements/widgets/text/TextWidgetView';
import TextIoWidgetView from '@/elements/widgets/text_io/TextIoWidgetView';

/** One kind of block, as the page draws it. */
export interface BlockKind {
  /** The one component. The designer and the delivered tool draw this same one. */
  View: ComponentType<WidgetViewProps>;
  /**
   * What the block shows is its *own* stored value rather than whatever last
   * arrived: a conversation, where the reply that arrived is one line of it.
   */
  ownsValue?: boolean;
}

export const BLOCKS: Record<WidgetKind, BlockKind> = {
  text: { View: TextWidgetView },
  divider: { View: DividerWidgetView },
  spacer: { View: SpacerWidgetView },
  input_picker: { View: InputPickerWidgetView },
  text_io: { View: TextIoWidgetView },
  plot_window: { View: PlotWindowWidgetView },
  image_view: { View: ImageViewWidgetView },
  table: { View: TableWidgetView },
  select: { View: SelectWidgetView },
  slider: { View: SliderWidgetView },
  button: { View: ButtonWidgetView },
  chat: { View: ChatWidgetView, ownsValue: true },
};
