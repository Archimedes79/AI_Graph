import { lazy } from 'react';
import type { WidgetUi } from '../../ElementUi';
import ImageViewWidgetView from './ImageViewWidgetView';
import { ImageViewWidget } from '@engine/elements/widgets/image_view/ImageViewWidget.ts';
import { fromEngine } from '@/authoring/generation';

export const imageViewWidgetUi: WidgetUi = {
  widgetKind: 'image_view',
  // Display-only, like plot_window: takes something to show, emits nothing.
  // Same snippet contract as plot_window, different destination: a path. This
  // widget had the code field and no button, purely because generation used to
  // be a switch in a shell rather than a declaration here.
  generation: {
    ...fromEngine(new ImageViewWidget().generation()),
    promptLabel: 'Prompt',
    promptPlaceholder: "Describe how to get an image path out of the incoming value, e.g. take the 'cover' field of each record.",
    bodyLabel: 'Optional transform — run(inputs) receives {"value"} and returns {"value"}',
    mono: true,
    bodyPlaceholder: 'Leave empty to display the incoming path as-is.',
    bodyHeight: 90,
  },
  Panel: lazy(() => import('./ImageViewWidgetPanel')),
  View: ImageViewWidgetView,
};
