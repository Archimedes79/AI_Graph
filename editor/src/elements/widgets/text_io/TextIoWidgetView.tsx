import React, { useCallback, useLayoutEffect, useRef } from 'react';
import type { WidgetViewProps } from '../WidgetView';
import SaveButton from '../SaveButton';
import { fileName, saveFile } from '../download';
import { asText } from '@engine/elements/widgets/text_io/text.ts';
import { textIoRole } from '@engine/elements/widgets/text_io/role.ts';
import { DIMMER, FIELD, LINE, SUNKEN, TEXT } from '@/ui/theme';
import { widgetFiresRun } from '@/document/guiWidgets';
import { BOX_TEXT } from '@/document/layout';

/**
 * How near its end a box counts as at its end, in pixels: a zoomed page
 * scrolls in fractions of a pixel, and the smallest turn of a wheel moves the
 * box many times this far.
 */
const NEAR_END = 8;

/**
 * Keeps a box that shows arriving text at its end, the way a log is read --
 * unless the person scrolled up to read, and then it stays where they are
 * until they scroll back down. Where they are is kept here as well: a browser
 * may move a box whose text is set, and staying is then putting it back.
 *
 * A box with nothing to scroll tells nothing about where the person reads: a
 * run empties the box while it works, and the empty box, at its end by
 * definition, had turned following back on under someone reading further up.
 */
function useFollow(text: string) {
  const box = useRef<HTMLElement | null>(null);
  const following = useRef(true);
  const kept = useRef(0);
  const resized = useRef<ResizeObserver | null>(null);

  useLayoutEffect(() => {
    const at = box.current;
    if (at) at.scrollTop = following.current ? at.scrollHeight : kept.current;
  }, [text]);

  // A box is drawn before the page has measured its grid, and a window can be
  // resized: a box that grows or shrinks moves its end, and one being followed
  // goes with it -- the newest line was left half under the edge.
  const ref = useCallback((element: HTMLElement | null) => {
    resized.current?.disconnect();
    box.current = element;
    if (!element || typeof ResizeObserver === 'undefined') return;
    resized.current = new ResizeObserver(() => {
      if (following.current) element.scrollTop = element.scrollHeight;
    });
    resized.current.observe(element);
  }, []);
  const onScroll = () => {
    const at = box.current;
    if (!at || at.scrollHeight <= at.clientHeight) return;
    kept.current = at.scrollTop;
    following.current = at.scrollHeight - at.scrollTop - at.clientHeight <= NEAR_END;
  };
  return { ref, onScroll };
}

/** Runtime text_io widget.
 * - "input": text area the user types in (drives graph via output port)
 * - "output": read-only display of incoming value
 * - "both": shows incoming value above, user text area below
 *
 * What it shows of a run follows the text as it grows and can be saved as a
 * text file; what is typed is the person's own, and already in their hands.
 */
export default function TextIoWidgetView({ widget, value, incoming, onChange, onTrigger }: WidgetViewProps) {
  const mode = textIoRole(widget.mode);
  const text = asText(value);
  const incomingText = asText(incoming);
  const follow = useFollow(mode === 'output' ? text : incomingText);
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
          ref={follow.ref}
          onScroll={follow.onScroll}
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
  return (
    <div className="flex flex-col gap-2 h-full">
      {/* The reply scrolls inside a frame that does not, so Save stays in its corner. */}
      <div className="relative group flex-1" style={{ minHeight: 40 }}>
        <div
          ref={follow.ref}
          onScroll={follow.onScroll}
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
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={sendOnEnter}
        placeholder="Your message…"
      />
    </div>
  );
}
