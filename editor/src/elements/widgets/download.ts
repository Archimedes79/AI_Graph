// Saving what a block shows as a file of its own -- a text as .txt, a chart as
// .svg, a table's rows as .csv -- wherever the page is drawn: the Page tab,
// the App tab and the delivered tool alike. The browser hands the file over, as it
// does for any link that says `download`; the page may be open on another
// machine than the graph, and nothing of the server's is asked.
//
// What goes into a file is made by plain functions, text in and text out, so
// they are tested without a page. `saveFile` and `drawnSvg` are the two that
// touch one.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Hands the person *content* as a file called *name*, the way a link that says `download` does. */
export function saveFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Not at once: a browser still reading the file when its address is revoked
  // saves nothing. A minute is long past any start, for a few bytes held.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * A file name for what a block shows: its label, less what a file system
 * refuses in a name (`\ / : * ? " < > |` and control characters) -- or
 * *fallback*, what the block is, where that leaves nothing.
 */
export function fileName(label: string | undefined, fallback: string, extension: string): string {
  const base = (label ?? '')
    .replace(/[\p{Cc}\\/:*?"<>|]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  return `${base || fallback}.${extension}`;
}

/**
 * Rows as CSV (RFC 4180): the header, then a line per row, a cell in quotes
 * where it holds a comma, a quote or a line break, and each quote in it
 * doubled. Every line ends in CRLF, as the RFC writes them.
 */
export function csvText(header: string[], rows: string[][]): string {
  const cell = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  return [header, ...rows].map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}

/** `var(--name)` or `var(--name, fallback)`, a fallback holding brackets of its own: `rgba(…)`, another `var(…)`. */
const VARIABLE = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\((?:[^()]|\([^()]*\))*\))*))?\)/g;

/**
 * *markup*, an `<svg>` as the page drew it, as a file that stands alone. What
 * the page lent it is written into it: the scheme's colours, which it reads as
 * CSS variables (*resolve* answers one by name; one it cannot answer falls
 * back as CSS would), the size it was drawn at, the SVG namespace -- and the
 * colour it stood on, without which a dark scheme's light labels are light
 * labels on a viewer's white.
 */
export function standaloneSvg(
  markup: string,
  drawn: { width: number; height: number; background?: string },
  resolve: (name: string) => string,
): string {
  const lent = (text: string): string => text.replace(VARIABLE, (whole, name: string, fallback?: string) =>
    resolve(name).trim() || (fallback === undefined ? whole : lent(fallback.trim())));
  return lent(markup).replace(/<svg\b[^>]*>/, (open) => {
    const tag = open
      .replace(/\s(?:xmlns|width|height)="[^"]*"/g, '')
      .replace(/^<svg/, `<svg xmlns="${SVG_NS}" width="${drawn.width}" height="${drawn.height}"`);
    const ground = drawn.background && !tag.endsWith('/>')
      ? `<rect width="100%" height="100%" fill="${drawn.background}"/>`
      : '';
    return tag + ground;
  });
}

/** *svg* as it is drawn on the page, as a file (`standaloneSvg`). */
export function drawnSvg(svg: SVGSVGElement): string {
  const box = svg.getBoundingClientRect();
  const style = getComputedStyle(svg);
  return standaloneSvg(
    new XMLSerializer().serializeToString(svg),
    { width: Math.round(box.width), height: Math.round(box.height), background: groundOf(svg) },
    (name) => style.getPropertyValue(name),
  );
}

/** The colour *element* stands on: the nearest background, its own or behind it, that nothing shows through. */
function groundOf(element: Element): string | undefined {
  for (let at: Element | null = element; at; at = at.parentElement) {
    const colour = getComputedStyle(at).backgroundColor;
    // Computed, a colour is `rgb(…)` when opaque and `rgba(…)` when anything shows through.
    if (colour.startsWith('rgb(')) return colour;
  }
  return undefined;
}
