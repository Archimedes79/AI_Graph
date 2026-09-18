import { lazy } from 'react';
import type { WidgetUi } from '../../ElementUi';
import TextWidgetView from './TextWidgetView';

/** Prose on the page, rendered as markdown. No ports — see `StaticWidget`. */
export const textWidgetUi: WidgetUi = {
  widgetKind: 'text',
  Panel: lazy(() => import('./TextWidgetPanel')),
  View: TextWidgetView,
  // Typed where it stands, on the page being built.
  inlineText: true,
};
