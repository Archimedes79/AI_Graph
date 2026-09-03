import React, { createContext, useContext, useState } from 'react';
import type { AICall } from '../../utils/api';
import { ACCENT_TEXT, DIMMER, LINE, MUTED, SUNKEN, TEXT } from '../../ui/theme';

const NOTHING: AICall[] = [];
const Transcript = createContext<AICall[]>(NOTHING);
/** The same, for a generation still running. Empty whenever none is. */
const Live = createContext<AICall[]>(NOTHING);

/** What the generation running right now has sent so far. */
export function useLiveGeneration(): AICall[] {
  return useContext(Live);
}

/** A finished result waiting to be taken, and the two ways to answer it. */
export interface Review { pending: boolean; accept: () => void; discard: () => void }
const NO_REVIEW: Review = { pending: false, accept: () => {}, discard: () => {} };
const Waiting = createContext<Review>(NO_REVIEW);

export function useGenerationReview(): Review {
  return useContext(Waiting);
}

/**
 * Hand the transcript of one ✨ button to whatever draws that button's result.
 *
 * A context rather than a prop because the path from the component that owns
 * `useGenerate` down to the one that draws the message runs through eight
 * element editors that do nothing with it but pass it on. That row of
 * forwarding props is what let the ✨ button drift apart in the first place --
 * see AuthoredBodyEditor.
 */
export function GenerationReport(
  { calls, live = NOTHING, review = NO_REVIEW, children }:
  { calls: AICall[]; live?: AICall[]; review?: Review; children: React.ReactNode },
) {
  return (
    <Transcript.Provider value={calls}>
      <Live.Provider value={live}>
        <Waiting.Provider value={review}>{children}</Waiting.Provider>
      </Live.Provider>
    </Transcript.Provider>
  );
}

/**
 * What the ✨ button actually sent, and what came back.
 *
 * Generation was a black box: press it, wait, receive text or an error. When
 * the error is "the model may still be loading, or the request exceeded its
 * context window", there is no way to tell which -- and no way to see that the
 * prompt had grown to forty thousand characters because an example file was
 * attached three nodes ago.
 *
 * Collapsed to one line by default, because the answer is what you wanted and
 * the transcript is what you want *when the answer is wrong*. Open, it is the
 * whole exchange in order: generating code is not one call but three or four --
 * write it, run it against real inputs, repair it -- and which pass went wrong
 * is the first thing worth knowing.
 */
export default function GenerationTranscript() {
  const calls = useContext(Transcript);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<number | null>(null);

  if (!calls.length) return null;

  const sent = calls.reduce((total, call) => total + call.sent_chars, 0);
  const seconds = calls.reduce((total, call) => total + call.seconds, 0);
  const failed = calls.filter((call) => call.error).length;

  return (
    <div className="mt-2 text-xs" style={{ color: MUTED }}>
      <button
        onClick={() => setOpen((was) => !was)}
        className="w-full text-left px-2 py-1 rounded"
        style={{ color: failed ? ACCENT_TEXT : MUTED, background: SUNKEN }}
      >
        {open ? '▾' : '▸'} {calls.length === 1 ? '1 Aufruf' : `${calls.length} Aufrufe`}
        {' · '}{sent.toLocaleString('de-DE')} Zeichen gesendet
        {seconds > 0 && ` · ${seconds.toFixed(1)}s`}
        {failed > 0 && ` · ${failed} fehlgeschlagen`}
      </button>

      {open && (
        <div className="mt-1 space-y-1">
          {calls.map((call, index) => (
            <div key={index} className="rounded" style={{ border: `1px solid ${LINE}` }}>
              <button
                onClick={() => setShown((was) => (was === index ? null : index))}
                className="w-full text-left px-2 py-1"
                style={{ color: call.error ? ACCENT_TEXT : MUTED }}
              >
                {shown === index ? '▾' : '▸'} {index + 1}. {call.provider}/{call.model}
                {' · '}{call.sent_chars.toLocaleString('de-DE')} hin
                {call.reply_chars > 0 && ` · ${call.reply_chars.toLocaleString('de-DE')} zurück`}
                {call.seconds > 0 && ` · ${call.seconds.toFixed(1)}s`}
                {call.error && ' · Fehler'}
              </button>

              {shown === index && (
                <div className="px-2 pb-2 space-y-2">
                  <Part label="System" text={call.system} />
                  <Part label="Prompt" text={call.prompt} />
                  {call.error
                    ? <Part label="Fehler" text={call.error} tone={ACCENT_TEXT} />
                    : <Part label="Antwort" text={call.reply ?? ''} />}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One side of one exchange.
 *
 * Scrolls rather than truncates: a prompt gets opened precisely when it might
 * be too long, and a transcript that hides the end hides the thing being looked
 * for. Empty parts are dropped, so a generation with no system prompt does not
 * show a labelled empty box.
 */
function Part({ label, text, tone }: { label: string; text: string; tone?: string }) {
  if (!text.trim()) return null;
  return (
    <div>
      <div className="mb-0.5" style={{ color: DIMMER }}>
        {label} · {text.length.toLocaleString('de-DE')} Zeichen
      </div>
      <pre
        className="whitespace-pre-wrap break-words rounded p-2 overflow-auto"
        style={{
          background: SUNKEN,
          color: tone ?? TEXT,
          border: `1px solid ${LINE}`,
          maxHeight: 220,
          fontSize: 11,
        }}
      >
        {text}
      </pre>
    </div>
  );
}
