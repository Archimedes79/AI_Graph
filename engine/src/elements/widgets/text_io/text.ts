// A value, as a box of text reads it.
//
// A text box's out port is text, and what arrives on its in port may be
// anything: a chart's rows wired in to be read, a model's answer as an
// object, a summary per file. What the box hands on should be what the page
// shows in it, so the page's blocks show a value with this same function. It
// had one of its own, alike by hand.

/**
 * Text as it is; a list as its items, one per line -- a blank line between
 * them once one is a paragraph, or three answers read as one; anything else
 * as the JSON it is. `String()` of an object is "[object Object]", which says
 * nothing about the value it replaced.
 */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const items = value.map(asText);
    return items.join(items.some((item) => item.length > 80) ? '\n\n' : '\n');
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
