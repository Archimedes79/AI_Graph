import type { GuiWidgetElementDefinition } from '@/elements/types';
import ImageViewEditor from './Editor';
import ImageViewWidget from '@/components/gui/widgets/ImageViewWidget';
import { ImageViewElement } from '../element.ts';
import { fromEngine } from '@/elements/shared/generation';

export const imageViewElement: GuiWidgetElementDefinition = {
  widgetKind: 'image_view',
  // Display-only, like plot_window: takes something to show, emits nothing.
  // Same snippet contract as plot_window, different destination: a path. This
  // widget had the code field and no button, purely because generation used to
  // be a switch in a shell rather than a declaration here.
  generation: {
    ...fromEngine(new ImageViewElement().generation()),
    promptLabel: 'Prompt',
    promptPlaceholder: "Describe how to get an image path out of the incoming value, e.g. take the 'cover' field of each record.",
    bodyLabel: 'Optional transform — run(inputs) receives {"value"} and returns {"value"}',
    mono: true,
    bodyPlaceholder: 'Leave empty to display the incoming path as-is.',
    bodyHeight: 90,
  },
  ConfigEditor: ImageViewEditor,
  RuntimeWidget: ImageViewWidget,
};
