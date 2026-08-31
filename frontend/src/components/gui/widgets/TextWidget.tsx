import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import Markdown from '../markdown';
import { DIMMER, MUTED, TEXT } from '../../../ui/theme';

/**
 * Prose: a heading, a paragraph, or a caption — one widget, three roles.
 *
 * The role decides size and weight, and nothing else. Every one of them starts
 * at the top of its block, because a page where some text hangs from the top
 * and other text sits on the bottom has no baseline the eye can follow -- and
 * the heading was the one hanging the other way. Air between sections comes
 * from the spacer, where it is visible and adjustable, instead of from a block
 * that is taller than its contents.
 */
const ROLES = {
  heading: { fontSize: 19, fontWeight: 600, color: TEXT, letterSpacing: '-0.01em' },
  body: { fontSize: 13, fontWeight: 400, color: TEXT, letterSpacing: 'normal' },
  caption: { fontSize: 11, fontWeight: 400, color: MUTED, letterSpacing: 'normal' },
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
      <div className="h-full flex items-start" style={{ color: DIMMER, fontSize: style.fontSize }}>
        {role === 'heading' ? 'Überschrift' : role === 'caption' ? 'Bildunterschrift' : 'Text…'}
      </div>
    );
  }

  // A heading is one line, so it renders as plain text rather than through the
  // markdown block parser, which would wrap it in a paragraph.
  if (role === 'heading') {
    return (
      <div
        className="h-full flex items-start"
        style={{ color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing }}
      >
        {source}
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-auto flex flex-col items-start"
      style={{ color: style.color, fontSize: style.fontSize }}
    >
      <Markdown source={source} />
    </div>
  );
}
