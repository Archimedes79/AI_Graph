// What the header's ✨ AI Graph and the bar under the canvas ask of a request
// that takes a while: whether it is still the one wanted.

/**
 * Numbered requests of which only the last is still wanted: `ask` hands out
 * what tells a request whether it still is, and `cancel` makes none of them.
 *
 * ✨ AI Graph's Cancel closed the dialog and left the request running; opened
 * again, the dialog showed the old design as the answer to a new, empty
 * description, ready to load.
 */
export function lastAsked(): { ask: () => () => boolean; cancel: () => void } {
  let last = 0;
  return {
    ask: () => {
      last += 1;
      const mine = last;
      return () => mine === last;
    },
    cancel: () => { last += 1; },
  };
}
