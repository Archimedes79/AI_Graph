// What a box of text is for: typed into, shown in, or both.
//
// Its own tiny module, like `text.ts` beside it, because the page imports it
// too: the box's ports, what a run does with a reply that arrives, and what
// the page shows in the box as its value all follow the mode, and they must
// read it alike. The page had a copy of its own, kept alike by hand -- and
// what the page shows in a typing box has to be what a run sends from it.

export type TextIoRole = 'input' | 'output' | 'both';

/** What a stored mode means: anything but the three is "both", for the ports, a run, settling and the page alike. */
export function textIoRole(mode: unknown): TextIoRole {
  const role = String(mode ?? 'both');
  return (['input', 'output', 'both'].includes(role) ? role : 'both') as TextIoRole;
}
