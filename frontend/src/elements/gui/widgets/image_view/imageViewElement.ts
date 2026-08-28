import type { GuiWidgetElementDefinition } from '../../../types';
import ImageViewEditor from './ImageViewEditor';
import ImageViewWidget from '../../../../components/gui/widgets/ImageViewWidget';
import { codeExtension } from '../../../shared/authoredFileName';

export const imageViewElement: GuiWidgetElementDefinition = {
  widgetKind: 'image_view',
  // Display-only, like plot_window: takes something to show, emits nothing.
  ports: (widget) => {
    const inId = `${widget.id}_in`;
    const label = widget.label || widget.id;
    return {
      inputs: [{ id: inId, name: label, kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
      outputs: [],
    };
  },
  authoredFile: (widget) => ({ extension: codeExtension(widget), what: 'this transform' }),
  // Same snippet contract as plot_window, different destination: a path. This
  // widget had the code field and no button, purely because generation used to
  // be a switch in a shell rather than a declaration here.
  generation: {
    promptField: 'code_prompt',
    targetField: 'code',
    guard: 'Please describe how to get an image path out of the incoming value first.',
    success: '✅ Transform generated!',
  },
  ConfigEditor: ImageViewEditor,
  RuntimeWidget: ImageViewWidget,
};
