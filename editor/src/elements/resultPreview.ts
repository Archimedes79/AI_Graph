// What a value looks like, small: the one line, count, sketch or picture a node
// on the graph canvas shows of what it made last (`canvas/ResultPreview.tsx`
// draws it).
//
// Read by the value's shape -- a text, a number, a list of rows, a chart's
// figure, a picture -- because that is what a person recognises at a glance.
// Where an element reads a value its own way it says so itself, and is asked:
// a page shows what each of its blocks shows (`NodeGuiBuilder.resultPreviews`),
// and a chart block reads a list of points as a chart (`WidgetGuiBuilder.preview`).

import { asDrawing, drawingSource, toFigure, type Figure } from './widgets/plot_window/PlotChart';

export type Preview =
  /** A text on one line: a text, a number, a record's first fields. */
  | { kind: 'line'; text: string }
  /** A list: how many, and the first of them on a line. */
  | { kind: 'rows'; count: number; noun: 'rows' | 'items'; first: string }
  /** Numbers, drawn as a tiny line or bars. */
  | { kind: 'sketch'; values: number[]; line: boolean }
  /** A picture, and how many there are. */
  | { kind: 'image'; src: string; count: number };

/** A node's previews by the port each stands beside: what it made comes out of a port, or arrived on one. */
export interface PortPreviews {
  inputs: Record<string, Preview>;
  outputs: Record<string, Preview>;
}

/** How much of a line is kept: more than a node shows, for the tooltip that shows the rest. */
const KEPT = 200;

/** How many numbers a sketch draws: more is no more readable at the width of a node. */
const DRAWN = 60;

/** *text* on one line, cut to what a tooltip can hold -- read no further than that needs. */
function oneLine(text: string): string {
  const line = text.slice(0, KEPT * 4).replace(/\s+/g, ' ').trim();
  return line.length > KEPT ? `${line.slice(0, KEPT - 1)}…` : line;
}

/** *values*, or as many of them, evenly spread, as a sketch draws. */
function thinned(values: number[]): number[] {
  if (values.length <= DRAWN) return values;
  return Array.from({ length: DRAWN }, (_, i) => values[Math.round((i * (values.length - 1)) / (DRAWN - 1))]);
}

/** A value in a few words: a record as its fields, anything else as itself. */
function brief(value: unknown): string {
  if (typeof value === 'string') return oneLine(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return oneLine(JSON.stringify(value) ?? String(value));
  return oneLine(Object.entries(value)
    .map(([key, field]) => `${key}: ${field !== null && typeof field === 'object' ? JSON.stringify(field) : String(field)}`)
    .join(', '));
}

/** A text a page shows as a picture -- a data URL of an image, an image's address, finished SVG -- as a source. */
function pictureOf(text: string): string | undefined {
  const value = text.trim();
  if (/^data:image\//i.test(value) || /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?$/i.test(value)) return value;
  const drawing = asDrawing(value);
  return drawing ? drawingSource(drawing) : undefined;
}

/** A chart's figure, as the sketch of its values -- or, with none yet, its title, which says why. */
export function figurePreview(figure: Figure): Preview {
  if (!figure.points.length) return { kind: 'line', text: oneLine(figure.title) };
  return { kind: 'sketch', values: thinned(figure.points.map((point) => point.value)), line: figure.kind === 'line' };
}

/** A list: numbers as a sketch, pictures as the first of them, anything else counted with its first item. */
function listPreview(items: unknown[]): Preview {
  if (items.length > 1 && items.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return { kind: 'sketch', values: thinned(items as number[]), line: items.length > 12 };
  }
  // A failed item of a list run once per item is a null in its place: counted, not read.
  const present = items.filter((item) => item !== null && item !== undefined);
  const first = present[0];
  const src = typeof first === 'string' ? pictureOf(first) : undefined;
  if (src && present.every((item) => typeof item === 'string' && pictureOf(item))) return { kind: 'image', src, count: present.length };
  const records = present.length > 0 && present.every((item) => typeof item === 'object' && !Array.isArray(item));
  return { kind: 'rows', count: items.length, noun: records ? 'rows' : 'items', first: present.length ? brief(first) : '' };
}

/** What *value* shows as, small; nothing for a value that holds nothing. */
export function previewOf(value: unknown): Preview | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    if (!value.trim()) return undefined;
    const src = pictureOf(value);
    return src ? { kind: 'image', src, count: 1 } : { kind: 'line', text: oneLine(value) };
  }
  if (typeof value !== 'object') return { kind: 'line', text: String(value) };
  if (Array.isArray(value)) return listPreview(value);
  const figure = toFigure(value);
  if (figure) return figurePreview(figure);
  const text = brief(value);
  return text ? { kind: 'line', text } : undefined;
}

/** A failed node's reason, as the one line under it: the first line of what it said. */
export function errorLine(error: string | null | undefined): string {
  return oneLine((error ?? '').split('\n').find((line) => line.trim()) ?? '') || 'Failed';
}
