import React from 'react';
import type { GuiWidget } from '@/types/graph';
import { DIMMER, MUTED } from '@/ui/theme';

interface Props { widget: GuiWidget; onUpdate: (patch: Partial<GuiWidget>) => void }

/**
 * Prose. The role -- heading, body, caption -- comes from the palette entry you
 * picked and is not offered again here.
 *
 * A heading and a paragraph were two widget kinds for a moment; they hold the
 * same string, contribute the same ports (none) and are typed into the same
 * box. What differs is formatting, so it is a `mode`, the same field
 * `input_picker` and `text_io` already use for their own variants. That made
 * a "role" dropdown possible, and possible is not the same as sensible:
 * offering to turn a heading into body text is offering to undo the choice
 * that put it on the page, one panel away from the palette that makes it
 * properly.
 *
 * There is no text box here either, any more. The words are typed on the page,
 * where they stand (`inlineText`); a second box holding the same sentence, in a
 * panel beside it, was two places to edit one thing.
 */
export default function TextEditor({ widget }: Props) {
  const heading = (widget.mode || 'body') === 'heading';
  return (
    <div>
      <p className="text-xs" style={{ color: MUTED }}>Click the text on the page and type.</p>
      {!heading && (
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Markdown works: **bold**, *italic*, `code`, [link](url), - lists, and tables with |.
        </p>
      )}
    </div>
  );
}
