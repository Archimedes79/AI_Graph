import type { GuiWidgetElementDefinition } from '../../../types';
import ImageViewEditor from './ImageViewEditor';
import ImageViewWidget from '../../../../components/gui/widgets/ImageViewWidget';

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
  ConfigEditor: ImageViewEditor,
  RuntimeWidget: ImageViewWidget,
};
