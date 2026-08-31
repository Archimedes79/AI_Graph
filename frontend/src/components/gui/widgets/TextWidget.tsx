import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import Markdown from '../markdown';
import { DIMMER, MUTED, TEXT } from '../../../ui/theme';

/**
 * Prose: a heading, a paragraph, or a caption — one widget, three roles.
 *
 * The role decides two things, and they are exactly the two the eye reads:
 * size/weight, and **where the text sits in its box**. A heading sits at the
 * bottom, so the block's spare height becomes air *above* it and it belongs to
 * what follows. Body text sits at the top and fills downwards, the way a
 * paragraph does. A caption sits at the top too, small and quiet, because it
 * annotates the thing above it.
 */
const ROLES = {
  heading: { fontSize: 19, fontWeight: 600, color: TEXT, align: 'items-end', letterSpacing: '-0.01em' },
  body: { fontSize: 13, fontWeight: 400, color: TEXT, align: 'items-start', letterSpacing: 'normal' },
  caption: { fontSize: 11, fontWeight: 400, color: MUTED, align: 'items-start', letterSpacing: 'normal' },
} as const;

export type TextRole = keyof typeof ROLES;

export function textRole(mode: string | undefined): TextRole {
  return (mode && mode in ROLES ? mode : 'body') as TextRole;
}

export default function TextWidget({ widget }: GuiWidgetRuntimeProps) {
  const role = textRole(widget.mode);
  const style = ROLES[role];
  const source = typeof widget.value === 'string' ? widget.value : '';

  if (!source.trim()) {
    return (
      <div className={`h-full flex ${style.align}`} style={{ color: DIMMER, fontSize: style.fontSize }}>
        {role === 'heading' ? 'Überschrift' : role === 'caption' ? 'Bildunterschrift' : 'Text…'}
      </div>
    );
  }

  // A heading is one line, so it renders as plain text rather than through the
  // markdown block parser -- which would wrap it in a paragraph and lose the
  // bottom alignment that gives it its air.
  if (role === 'heading') {
    return (
      <div
        className={`h-full flex ${style.align}`}
        style={{ color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing }}
      >
        {source}
      </div>
    );
  }

  return (
    <div
      className={`h-full overflow-auto flex flex-col ${style.align}`}
      style={{ color: style.color, fontSize: style.fontSize }}
    >
      <Markdown source={source} />
    </div>
  );
}
