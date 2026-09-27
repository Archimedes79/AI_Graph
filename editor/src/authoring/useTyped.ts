import { useEffect, useRef, useState } from 'react';

/**
 * The text of a box whose stored form comes back tidied, kept as it is typed.
 *
 * Every keystroke is stored at once, and what is stored is read back as the
 * box's value: an example's JSON block is kept trimmed, an empty expectation
 * as `{}`, a data node's structure re-indented. Shown as it came back, a
 * newline typed at the end was taken away again with the caret, `{}` typed
 * into an empty expectation emptied the box, and half-typed JSON was
 * re-indented under the caret. So the box shows what was typed, and takes the
 * stored text only when it changed for another reason -- ⟳ from the graph, a
 * file, Keep under Try it, ✨, a run, an edit in the project's files.
 *
 * *write* stores what was typed and says what the stored text will read back
 * as: that is how its echo is told apart from a change. Filling the box from
 * elsewhere through the returned setter counts as typing it; what else the
 * setter is handed (*more*) is handed to *write* -- whether a file filled it.
 */
export function useTyped<More extends unknown[] = []>(
  stored: string, write: (text: string, ...more: More) => string,
): [string, (text: string, ...more: More) => void] {
  const [typed, setTyped] = useState(stored);
  const echo = useRef(stored);
  useEffect(() => {
    if (stored === echo.current) return;
    echo.current = stored;
    setTyped(stored);
  }, [stored]);
  const type = (text: string, ...more: More) => {
    setTyped(text);
    echo.current = write(text, ...more);
  };
  return [typed, type];
}
