// A node's heading: never empty.
//
// A node is its heading and its text. A new one is given a heading at once --
// its kind and a number, "Code 1" -- and while nobody has changed that, it
// becomes a short one written from the text as soon as there is a text. A
// heading field emptied is not a heading: it goes back to the one before.

/** The heading a new node of *kind* is given: the kind and the lowest number no heading in *taken* has. */
export function numberedHeading(kind: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) if (!used.has(`${kind} ${n}`)) return `${kind} ${n}`;
}

/** Whether *heading* is still one a new node is given -- a kind and a number: nobody has written one. */
export function isNumberedHeading(heading: string): boolean {
  return /^\S+ \d+$/.test(heading.trim());
}

/**
 * A short heading written from *text*: the start of its first sentence, up to
 * where the thought turns (a colon, a comma, a dash, " and "), at most six
 * words -- "Reads the CSV and says what the chart should show" is "Reads the
 * CSV". Undefined for a text that says nothing.
 */
export function headingFromText(text: string): string | undefined {
  const sentence = text.trim().split('\n')[0].split(/(?<=[.!?])\s/)[0];
  const clause = sentence.split(/\s+--\s+|[:;,(]|\s+and\s+/)[0].replace(/[.!?]+$/, '').trim();
  const words = clause.split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return undefined;
  const heading = words.join(' ');
  return heading.charAt(0).toUpperCase() + heading.slice(1);
}
