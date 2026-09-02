import { useCallback, useRef, useState } from 'react';
import { errorText } from '../../utils/errorText';
import { getGenerationProgress, type AICall } from '../../utils/api';

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
  /** Write the result into the node/widget config. */
  apply: (result: T) => void;
  pending?: string;
  /**
   * What to say when it worked. A function when the result itself decides --
   * generated code that was verified against real data has more to report than
   * "done".
   */
  success: string | ((result: T) => string);
  failure?: string;
}

/**
 * The ✨ Generate button's state machine, once.
 *
 * Seven handlers across three files repeated the identical seven steps --
 * guard, set busy, set "Generating…", await, apply, set "✅", catch and format
 * the error, clear busy -- differing only in the four things `GenerateOptions`
 * names. They also each spelled the axios error extraction slightly
 * differently, so the same backend failure read differently depending on which
 * button you pressed.
 *
 * `key` scopes busy state and message so one component can host several
 * buttons (the widget editor has one per widget); components with a single
 * button pass nothing and get the default key.
 */
export function useGenerate() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  // What the last generation actually sent and got back, per button.
  const [transcripts, setTranscripts] = useState<Record<string, AICall[]>>({});
  // The same thing while it is still happening, so the wait is not a blank box.
  const [live, setLive] = useState<Record<string, AICall[]>>({});
  const polling = useRef<Record<string, number>>({});

  const setMessage = useCallback((text: string, key = '') => {
    setMessages((prev) => ({ ...prev, [key]: text }));
  }, []);

  const run = useCallback(async <T,>(options: GenerateOptions<T>, key = '') => {
    const blocked = options.guard?.();
    if (blocked) {
      setMessage(`❌ ${blocked}`, key);
      return;
    }
    setActiveKey(key);
    setMessage(options.pending ?? 'Generating…', key);

    // A generation is several model calls over a minute or more. Asking every
    // half second for what has gone out so far turns that wait into something
    // a person can read and judge -- the prompt, the context, each step -- so
    // a wrong answer can be understood rather than only re-rolled.
    const progressId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setLive((prev) => ({ ...prev, [key]: [] }));
    polling.current[key] = window.setInterval(async () => {
      try {
        const { calls } = await getGenerationProgress(progressId);
        if (calls.length) setLive((prev) => ({ ...prev, [key]: calls }));
      } catch {
        // A poll that fails changes nothing: the generation is what matters.
      }
    }, 500);

    const stopPolling = () => {
      window.clearInterval(polling.current[key]);
      delete polling.current[key];
      setLive((prev) => ({ ...prev, [key]: [] }));
    };

    try {
      const result = await options.run(progressId);
      // Kept whether or not it worked out: a transcript is opened when
      // something went wrong, so the failing case is the one that needs it.
      const calls = (result as { calls?: AICall[] })?.calls;
      if (calls) setTranscripts((prev) => ({ ...prev, [key]: calls }));
      options.apply(result);
      setMessage(typeof options.success === 'function' ? options.success(result) : options.success, key);
    } catch (error) {
      const calls = (error as { response?: { data?: { calls?: AICall[] } } })?.response?.data?.calls;
      if (calls) setTranscripts((prev) => ({ ...prev, [key]: calls }));
      setMessage(`❌ ${errorText(error, options.failure ?? 'Generation failed')}`, key);
    } finally {
      stopPolling();
      setActiveKey(null);
    }
  }, [setMessage]);

  return {
    /** Is this particular button mid-flight? */
    isGenerating: (key = '') => activeKey === key,
    /** Is any button in this component mid-flight? */
    busy: activeKey !== null,
    message: (key = '') => messages[key] ?? '',
    /** Every model call the last generation on this button made. */
    transcript: (key = '') => transcripts[key] ?? [],
    /** The calls of a generation still running on this button, as they arrive. */
    liveTranscript: (key = '') => live[key] ?? [],
    setMessage,
    run,
  };
}
