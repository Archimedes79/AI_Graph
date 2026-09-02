import React, { useEffect, useRef } from 'react';
import type { AICall } from '../../utils/api';
import { DIMMER, FIELD, MUTED } from '../../ui/theme';

/**
 * What is happening while a ✨ button is busy.
 *
 * Generation used to be a minute of a spinning button and nothing else: what
 * was asked, what context went with it, whether the model had answered once
 * already and was being asked to repair its own code — all invisible until it
 * finished, and then only through a collapsed transcript nobody opens unless
 * something has already gone wrong.
 *
 * So this stands in the body's place while the body is being written, and is
 * gone the moment the result arrives. It is deliberately the *sent* text: a
 * bad answer is usually a bad question, and the question is the thing you
 * cannot otherwise see.
 */
export default function LiveGeneration({ calls, minHeight }: { calls: AICall[]; minHeight: number }) {
  const box = useRef<HTMLDivElement>(null);

  // Follow the newest step, the way a log does. Anchored to the bottom rather
  // than jumping to a step's start: the interesting end of a prompt is its end.
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [calls]);

  const waiting = calls.length === 0;

  return (
    <div
      ref={box}
      className="w-full rounded-lg px-3 py-2 text-xs font-mono overflow-auto whitespace-pre-wrap"
      style={{ ...FIELD, minHeight, maxHeight: minHeight * 2 }}
    >
      {waiting && (
        <span style={{ color: DIMMER }}>
          Asking the model… the prompt appears here as soon as it goes out.
        </span>
      )}

      {calls.map((call, index) => (
        <div key={index} className={index ? 'mt-3 pt-3' : ''} style={index ? { borderTop: '1px solid #1e2235' } : {}}>
          <div style={{ color: '#a78bfa' }}>
            {/* Numbered, because a repair pass is the second call and looking
                like the first is exactly how it goes unnoticed. */}
            {`step ${index + 1} — ${call.provider}/${call.model}`}
            {call.reply === null && call.error === null ? ' — waiting…' : ''}
            {call.error ? ` — failed: ${call.error}` : ''}
            {call.reply !== null ? ` — answered in ${call.seconds}s, ${call.reply_chars} chars` : ''}
          </div>

          {call.system && (
            <div className="mt-1">
              <span style={{ color: MUTED }}>system: </span>
              <span style={{ color: DIMMER }}>{call.system}</span>
            </div>
          )}

          <div className="mt-1">
            <span style={{ color: MUTED }}>{`prompt (${call.sent_chars} chars): `}</span>
            <span style={{ color: DIMMER }}>{call.prompt}</span>
          </div>

          {call.reply && (
            <div className="mt-1">
              <span style={{ color: MUTED }}>reply: </span>
              <span style={{ color: DIMMER }}>{call.reply}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
