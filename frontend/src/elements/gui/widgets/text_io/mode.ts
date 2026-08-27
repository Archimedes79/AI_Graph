import type { GuiWidget } from '../../../../types/graph';

/**
 * A text_io widget's effective mode.
 *
 * It decides the widget's ports, how it renders at runtime, and whether its
 * value is cleared after a run -- three places that must agree, and which had
 * three separate copies of this rule (one of them spelled differently).
 * Its own tiny module because the element and the runtime widget import each
 * other's neighbourhood; this way neither has to.
 */
export function effectiveTextIoMode(widget: Pick<GuiWidget, 'mode'>): 'input' | 'output' | 'both' {
  if (widget.mode === 'input' || widget.mode === 'output' || widget.mode === 'both') return widget.mode;
  return 'both';
}
