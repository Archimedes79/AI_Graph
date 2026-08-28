import { useCallback, useState } from 'react';
import { errorText } from '../../utils/errorText';

export interface GenerateOptions<T> {
  /**
   * Return why generation cannot start yet (e.g. "Please add a prompt first."),
   * or nothing to proceed.
   */
  guard?: () => string | undefined;
  /** The API call. */
  run: () => Promise<T>;
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
    try {
      const result = await options.run();
      options.apply(result);
      setMessage(typeof options.success === 'function' ? options.success(result) : options.success, key);
    } catch (error) {
      setMessage(`❌ ${errorText(error, options.failure ?? 'Generation failed')}`, key);
    } finally {
      setActiveKey(null);
    }
  }, [setMessage]);

  return {
    /** Is this particular button mid-flight? */
    isGenerating: (key = '') => activeKey === key,
    /** Is any button in this component mid-flight? */
    busy: activeKey !== null,
    message: (key = '') => messages[key] ?? '',
    setMessage,
    run,
  };
}
