import { useCallback, useRef, useState } from 'react';
import { errorText } from '@/api/errorText';
import { ApiError, watchGeneration, type AICall } from '@/api/client';

/** Said when ✨ was stopped: what it wrote before stays, what was on its way does not come. */
export const STOPPED = '⏹ Stopped: what was still on its way is not written.';

export interface GenerateOptions<T> {
  /**
   * Return why generation cannot start yet (e.g. "Please add a prompt first."),
   * or nothing to proceed.
   */
  guard?: () => string | undefined;
  /**
   * The API call. It is handed an id it can pass on as `progress_id`, which is
   * what lets the transcript be read while it is still being written.
   */
  run: (progressId?: string) => Promise<T>;
  /** Write the result into the node. */
  apply: (result: T) => void;
  pending?: string;
  /**
   * What to say when it worked. A function when the result itself decides --
   * generated code that was verified against real data has more to report than
   * "done".
   */
  success: string | ((result: T) => string);
  failure?: string;
  /** Told the calls of a generation that failed, which are worth keeping as much as those of one that worked. */
  failed?: (calls: AICall[]) => void;
}

/**
 * The ✨ buttons' state machine, once.
 *
 * Seven handlers across three files repeated the identical seven steps --
 * guard, set busy, set "Generating…", await, apply, set "✅", catch and format
 * the error, clear busy -- differing only in the four things `GenerateOptions`
 * names. They also each spelled the axios error extraction slightly
 * differently, so the same backend failure read differently depending on which
 * button you pressed.
 *
 * What comes back is written in at once, as one undo step: Undo is how it is
 * taken back, as for anything else changed in a node's panel. It used to wait
 * for Accept or Discard -- a click after every ✨, with the result on screen
 * but not in the node, so nothing could try it. The exchange that produced it
 * stays on screen either way (`GenerationTranscript`).
 */
export function useGenerate() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // What the last generation actually sent and got back.
  const [transcript, setTranscript] = useState<AICall[]>([]);
  // The same thing while it is still happening, so the wait is not a blank box.
  const [live, setLive] = useState<AICall[]>([]);
  // How the generation in flight is stopped.
  const inFlight = useRef<AbortController | null>(null);

  /** Generate, and write what comes back. Resolves to whether it was written. */
  const run = useCallback(async <T,>(options: GenerateOptions<T>): Promise<boolean> => {
    const blocked = options.guard?.();
    if (blocked) {
      setMessage(`❌ ${blocked}`);
      return false;
    }
    const stopping = new AbortController();
    inFlight.current = stopping;
    setBusy(true);
    setMessage(options.pending ?? 'Generating…');

    // What has gone out so far, while it runs: a wrong answer can then be
    // understood rather than only re-rolled.
    setLive([]);
    try {
      const result = await watchGeneration(options.run, setLive, stopping.signal);
      // Kept whether or not it worked out: a transcript is opened when
      // something went wrong, so the failing case is the one that needs it.
      const calls = (result as { calls?: AICall[] })?.calls;
      if (calls) setTranscript(calls);
      options.apply(result);
      setMessage(typeof options.success === 'function' ? options.success(result) : options.success);
      return true;
    } catch (error) {
      if (stopping.signal.aborted) {
        setMessage(STOPPED);
        return false;
      }
      const calls = error instanceof ApiError ? error.body.calls : undefined;
      if (calls) setTranscript(calls);
      if (calls?.length) options.failed?.(calls);
      setMessage(`❌ ${errorText(error, options.failure ?? 'Generation failed')}`);
      return false;
    } finally {
      inFlight.current = null;
      setLive([]);
      setBusy(false);
    }
  }, []);

  /**
   * Stop the generation in flight, as the bar's Stop does a change of the
   * graph: nothing more is waited for, and what it still brings back is
   * dropped. A call that hung held every ✨ and ▶ Try of the node with it.
   */
  const stop = useCallback(() => inFlight.current?.abort(), []);

  return {
    /** Whether ✨ is writing now. */
    busy,
    message,
    /** Every model call the last generation made. */
    transcript,
    /** The calls of a generation still running, as they arrive. */
    live,
    run,
    stop,
  };
}
