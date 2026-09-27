import React from 'react';
import type { WidgetViewProps } from '../WidgetView';
import SaveButton from '../SaveButton';
import { fileName, saveFile } from '../download';
import { asText } from '@engine/elements/widgets/text_io/text.ts';
import { textIoRole } from '@engine/elements/widgets/text_io/role.ts';
import { DIMMER, FIELD, LINE, SUNKEN, TEXT } from '@/ui/theme';
import { widgetFiresRun } from '@/document/guiWidgets';
import { BOX_TEXT } from '@/document/layout';

/** Runtime text_io widget.
 * - "input": text area the user types in (drives graph via output port)
 * - "output": read-only display of incoming value
 * - "both": shows incoming value above, user text area below
 *
 * What it shows of a run can be saved as a text file; what is typed is the
 * person's own, and already in their hands.
 */
export default function TextIoWidgetView({ widget, value, incoming, onChange, onTrigger }: WidgetViewProps) {
  const mode = textIoRole(widget.mode);
  const text = asText(value);
  // In a box that sends, Enter sends and Shift+Enter is the newline -- what
  // every messenger does. In one that does not, Enter is just a newline.
  // Whether it sends is the engine's answer, the one the page acts on.
  const sends = widgetFiresRun(widget);
  const sendOnEnter = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!sends || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const typed = event.currentTarget.value;
    if (typed.trim()) onTrigger?.(typed);
  };
  const saveButton = (shown: string) => shown.trim() !== '' && (
    <SaveButton
      title="Save this text as a file"
      onSave={() => saveFile(fileName(widget.label, 'output', 'txt'), shown, 'text/plain')}
    />
  );

  if (mode === 'output') {
    return (
      <div className="relative group h-full">
        <textarea
          className="w-full h-full rounded-lg px-2 py-1.5 resize-none"
          style={{ ...FIELD, ...BOX_TEXT, minHeight: 80 }}
          value={text}
          readOnly
          placeholder="Waiting for output…"
        />
        {saveButton(text)}
      </div>
    );
  }

  if (mode === 'input') {
    return (
      <textarea
        className="w-full h-full rounded-lg px-2 py-1.5 resize-none"
        style={{ ...FIELD, ...BOX_TEXT, minHeight: 80 }}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={sendOnEnter}
        placeholder={sends ? 'Type and press Enter…' : 'Type your input…'}
      />
    );
  }

  // "both": the last run's reply above, the user's next message below. The two
  // panes read different props on purpose -- feeding both from one value is
  // what used to make the reply disappear as soon as the user started typing.
  const incomingText = asText(incoming);
  return (
    <div className="flex flex-col gap-2 h-full">
      {/* The reply scrolls inside a frame that does not, so Save stays in its corner. */}
      <div className="relative group flex-1" style={{ minHeight: 40 }}>
        <div
          className="absolute inset-0 rounded-lg px-2 py-1.5 overflow-auto whitespace-pre-wrap"
          style={{ ...BOX_TEXT, background: SUNKEN, color: TEXT, border: `1px solid ${LINE}` }}
        >
          {incomingText || <span style={{ color: DIMMER }}>Incoming value appears here…</span>}
        </div>
        {saveButton(incomingText)}
      </div>
      <textarea
        className="w-full rounded-lg px-2 py-1.5 resize-none"
        style={{ ...FIELD, ...BOX_TEXT, minHeight: 60 }}
        value={asText(value)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={sendOnEnter}
        placeholder="Your message…"
      />
    </div>
  );
}
