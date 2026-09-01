import type { GuiWidgetElementDefinition } from '../../../types';
import ImageViewEditor from './ImageViewEditor';
import ImageViewWidget from '../../../../components/gui/widgets/ImageViewWidget';

export const imageViewElement: GuiWidgetElementDefinition = {
  widgetKind: 'image_view',
  // Display-only, like plot_window: takes something to show, emits nothing.
  authoredFile: (widget) => ({ extension: '.js', what: 'this transform' }),
  // Same snippet contract as plot_window, different destination: a path. This
  // widget had the code field and no button, purely because generation used to
  // be a switch in a shell rather than a declaration here.
  generation: {
    promptField: 'code_prompt',
    targetField: 'code',
    guard: 'Please describe how to get an image path out of the incoming value first.',
    success: '✅ Transform generated!',
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
