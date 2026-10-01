// What a node that reads a file is handed, for a file that is not plain text.
//
// "Read the file at this path" hands a node what is in the file. For text that
// is the text. A Word document is text too, kept in zipped XML: it is handed as
// Markdown, so its headings, lists, emphasis and tables survive the reading. A
// picture or a PDF has no text to hand, so it is handed as itself -- a `data:`
// URL -- which an AI node sends to the model as the file it is (`ask.ts`), and
// which a model that reads PDFs reads in whatever layout it came.
//
// Here and not in the host: unzipping is `DecompressionStream`, which the
// browser has as well as Node, and the editor imports what reads file ports.

import type { FileService } from './Runtime.ts';
import { MAX_INLINE_IMAGE_BYTES, imageMediaType } from './images.ts';

/** The media type of a file handed as itself, or null for one handed as text. */
export function inlineMediaType(path: string): string | null {
  return /\.pdf$/i.test(path) ? 'application/pdf' : imageMediaType(path);
}

/** A `data:` URL of a file handed as itself -- a picture, a PDF -- that a model can be sent. */
export function isInlineFile(value: unknown): boolean {
  return typeof value === 'string' && /^data:(image\/[\w.+-]+|application\/pdf);base64,/.test(value);
}

/** What is in the file at *path*, as a node reading it is handed it. */
export async function fileContent(path: string, files: FileService): Promise<string> {
  if (/\.docx$/i.test(path)) return docxMarkdown(Uint8Array.from(atob(await files.read(path, 'binary')), (c) => c.charCodeAt(0)));
  const mediaType = inlineMediaType(path);
  if (!mediaType) return files.read(path);
  const bytes = await files.size?.(path) ?? 0;
  if (bytes > MAX_INLINE_IMAGE_BYTES) {
    throw new Error(`${path} is ${(bytes / 1024 / 1024).toFixed(1)} MB; a file sent as it is may have ${MAX_INLINE_IMAGE_BYTES / 1024 / 1024} MB.`);
  }
  return `data:${mediaType};base64,${await files.read(path, 'binary')}`;
}

/** The files of a zip archive that *wanted* names, unpacked. */
async function unzip(zip: Uint8Array, wanted: string[]): Promise<Map<string, string>> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = zip.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('Not a Word document: it is no zip archive.');
  const found = new Map<string, string>();
  let at = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n -= 1) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    const local = view.getUint32(at + 42, true);
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (!wanted.includes(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const packed = zip.slice(start, start + size);
    const bytes = method === 0
      ? packed
      : new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    found.set(name, new TextDecoder().decode(bytes));
  }
  return found;
}

const entities = (text: string): string => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex: string, code: string) => String.fromCodePoint(parseInt(code, hex ? 16 : 10)))
  .replace(/&amp;/g, '&');

/** Whether a run property such as `<w:b/>` is on: present, and not set to off. */
const on = (properties: string, tag: string): boolean =>
  new RegExp(`<w:${tag}(?: w:val="(?!0|false|none)[^"]*")?\\s*/>`).test(properties);

/** The text of a paragraph, its runs' bold and italic as Markdown. */
function runsOf(paragraph: string): string {
  let text = '';
  for (const [, run] of paragraph.matchAll(/<w:r[ >]([\s\S]*?)<\/w:r>/g)) {
    const properties = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? '';
    let words = '';
    for (const [piece] of run.matchAll(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
      words += piece === '<w:tab/>' ? '\t' : piece === '<w:br/>' ? '\n' : entities(piece.replace(/<[^>]+>/g, ''));
    }
    if (!words.trim()) { text += words; continue; }
    const mark = (on(properties, 'b') ? '**' : '') + (on(properties, 'i') ? '*' : '');
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(words)!;
    text += mark ? `${lead}${mark}${core}${[...mark].reverse().join('')}${trail}` : words;
  }
  // Two bold runs side by side are one bold stretch.
  return text.replace(/\*\*\*\*/g, '');
}

/**
 * A Word document's body as Markdown: headings (a style named Heading or
 * Überschrift with its level, a title), lists bulleted or numbered as its
 * numbering says, bold and italic, tables. What has no Markdown -- pictures,
 * footnotes, equations -- is left out rather than guessed at.
 */
export async function docxMarkdown(zip: Uint8Array): Promise<string> {
  const parts = await unzip(zip, ['word/document.xml', 'word/numbering.xml', 'word/styles.xml']);
  const document = parts.get('word/document.xml');
  if (!document) throw new Error('Not a Word document: there is no word/document.xml in it.');

  // A style's name says what it is, whatever its id in this language.
  const styleNames = new Map<string, string>();
  for (const [, id, name] of (parts.get('word/styles.xml') ?? '').matchAll(/<w:style [^>]*w:styleId="([^"]+)"[\s\S]*?<w:name w:val="([^"]+)"/g)) {
    styleNames.set(id, name.toLowerCase());
  }
  const numbering = parts.get('word/numbering.xml') ?? '';
  const abstractOf = new Map([...numbering.matchAll(/<w:num w:numId="(\d+)"[^>]*>\s*<w:abstractNumId w:val="(\d+)"/g)].map(([, num, abs]) => [num, abs]));
  const formats = new Map<string, string>();
  for (const [, abs, body] of numbering.matchAll(/<w:abstractNum [^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    for (const [, level, format] of body.matchAll(/<w:lvl w:ilvl="(\d+)"[\s\S]*?<w:numFmt w:val="([^"]+)"/g)) formats.set(`${abs}:${level}`, format);
  }

  const paragraph = (xml: string): string => {
    const properties = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(xml)?.[1] ?? '';
    const text = runsOf(xml).trim();
    if (!text) return '';
    const style = /<w:pStyle w:val="([^"]+)"/.exec(properties)?.[1] ?? '';
    const name = styleNames.get(style) ?? style.toLowerCase();
    const level = /^(?:heading|.*berschrift)\s*(\d)$/.exec(name)?.[1];
    // The title is the one #, so a heading of level n is n + 1 of them.
    if (level) return `${'#'.repeat(Number(level) + 1)} ${text.replace(/\*+/g, '')}`;
    if (name === 'title' || name === 'titel') return `# ${text.replace(/\*+/g, '')}`;
    const list = /<w:numPr>[\s\S]*?<w:ilvl w:val="(\d+)"[\s\S]*?<w:numId w:val="(\d+)"/.exec(properties);
    if (list && list[2] !== '0') {
      const [, depth, num] = list;
      const ordered = (formats.get(`${abstractOf.get(num)}:${depth}`) ?? 'bullet') !== 'bullet';
      return `${'  '.repeat(Number(depth))}${ordered ? '1.' : '-'} ${text}`;
    }
    return text;
  };

  const blocks: string[] = [];
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(document)?.[1] ?? '';
  for (const [block] of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    if (!block.startsWith('<w:tbl>')) {
      const said = paragraph(block);
      if (said) blocks.push(said);
      continue;
    }
    const rows = [...block.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map(([row]) =>
      [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(([cell]) =>
        [...cell.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(([p]) => runsOf(p).trim()).filter(Boolean).join(' ').replace(/\|/g, '\\|')));
    if (!rows.length) continue;
    const width = Math.max(...rows.map((row) => row.length));
    const line = (cells: string[]): string => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`;
    blocks.push([line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n'));
  }
  // Items of one list are one block: no blank line between them.
  return blocks.join('\n\n').replace(/^((?: *)(?:-|1\.) .*)\n\n(?=(?: *)(?:-|1\.) )/gm, '$1\n') + '\n';
}
