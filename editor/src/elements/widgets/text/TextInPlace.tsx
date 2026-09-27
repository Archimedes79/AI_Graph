import React from 'react';
import { textRole } from '@engine/elements/widgets/text/role.ts';
import { GUI_GAP } from '@/document/layout';
import type { InlineEditorProps } from '../../WidgetGuiBuilder';
import { TEXT_ROLES } from './TextWidgetView';

/**
 * A heading or a paragraph, typed where it stands on the page being built
 * (`WidgetGuiBuilder.InlineEditor`).
 *
 * The box grows with what is written — rows are added as the text needs them,
 * never taken away, so a size someone chose on purpose stays chosen.
 */
export default function TextInPlace({ widget, cell, rows, onText, onRows }: InlineEditorProps) {
  const box = React.useRef<HTMLTextAreaElement | null>(null);
  const role = textRole(widget.mode);

  React.useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    // Once, on entering the block: focus follows selection, not every keystroke.
  }, [widget.id]);

  const fit = (element: HTMLTextAreaElement) => {
    const needed = Math.ceil((element.scrollHeight + 6 + GUI_GAP) / (cell + GUI_GAP));
    if (needed > rows) onRows(needed);
  };

  return (
    <textarea
      ref={box}
      className="w-full h-full resize-none bg-transparent outline-none"
      style={{ ...TEXT_ROLES[role], border: 'none', padding: 0, fontFamily: 'inherit', lineHeight: 1.45 }}
      value={typeof widget.value === 'string' ? widget.value : ''}
      onChange={(event) => { onText(event.target.value); fit(event.target); }}
      onMouseDown={(event) => event.stopPropagation()}
      placeholder={role === 'heading' ? 'Heading' : 'Write something… Markdown works: **bold**, lists, links'}
      spellCheck
    />
  );
}
