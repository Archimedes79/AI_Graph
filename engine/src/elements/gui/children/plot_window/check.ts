// Looking at a drawing without a screen.
//
// A generated chart transform is run once before anyone sees it, and running
// proves only that it runs. Asked for a line chart of a temperature over
// `"08:00"`, `"08:05"`, …, two different small models both returned a
// well-formed SVG whose every x was `NaN`: the right key, the right viewBox, an
// empty picture. Nothing caught it, because nothing looked.
//
// This looks. Not by rendering -- there is no browser in the engine, and none
// is needed: what goes wrong in a generated drawing is arithmetic, and
// arithmetic is in the attributes. A number that is not a number, a label
// placed outside the box it will be clipped by, a frame with nothing in it.
// Each finding is a sentence the model can act on, because the repair pass
// hands them straight back to it.
//
// **Colour is not checked.** Whoever asked for the chart may have asked for
// red, and a threshold line *should* be red on every page. The model is told
// what the page looks like and which colours follow it (see the contract in
// `element.ts`); what it does with that is its answer, not an error.

import { PLOT_VIEW } from './view.ts';

/** How far outside its box a coordinate may fall before it is called out: strokes and anchors overhang a little. */
const SLACK = 0.04;

const MARKS = /<(rect|path|line|circle|ellipse|polyline|polygon)\b/i;

/** Every numeric attribute that places something, with where it appeared. */
function placements(svg: string): { tag: string; name: string; value: number; raw: string }[] {
  const found: { tag: string; name: string; value: number; raw: string }[] = [];
  for (const element of svg.matchAll(/<(\w+)\b([^>]*)>/g)) {
    const [, tag, attributes] = element;
    if (tag === 'svg') continue;
    for (const attribute of attributes.matchAll(/\s(x|y|x1|x2|y1|y2|cx|cy)="([^"]*)"/g)) {
      found.push({ tag, name: attribute[1], value: Number(attribute[2]), raw: attribute[2] });
    }
  }
  return found;
}

/** What is wrong with a finished SVG, as sentences. Empty when nothing is. */
export function checkDrawing(svg: string): string[] {
  const problems: string[] = [];

  const box = /viewBox="\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  if (!box) {
    problems.push(`The <svg> has no viewBox. The block is resizable, so without one the drawing is cut off or tiny: `
      + `use viewBox="0 0 ${PLOT_VIEW.width} ${PLOT_VIEW.height}" with width="100%" height="100%".`);
  }

  // The most common failure by far: a label column ("08:00", "Berlin") used as a
  // number. It shows up as NaN in an attribute, and draws nothing.
  const broken = [...svg.matchAll(/\s([\w:-]+)="([^"]*\b(?:NaN|undefined|Infinity)\b[^"]*)"/g)].slice(0, 3);
  if (broken.length) {
    problems.push(`The markup contains values that are not numbers -- ${broken.map((m) => `${m[1]}="${m[2].slice(0, 40)}"`).join(', ')}. `
      + 'Something that is a label (a time, a name) was used in arithmetic. Place categories by their INDEX in the list, '
      + 'and convert values with Number() only where the data really is numeric.');
  }

  if (!MARKS.test(svg)) {
    problems.push('The drawing contains no marks at all (no rect, path, line, circle, polyline): it is an empty frame. '
      + 'If the input was empty that is right; with the sample data above it is not.');
  }

  if (box) {
    const [left, top, width, height] = box.slice(1).map(Number);
    const outside = placements(svg).filter((p) => Number.isFinite(p.value) && (
      /^(x|x1|x2|cx)$/.test(p.name)
        ? p.value < left - width * SLACK || p.value > left + width * (1 + SLACK)
        : p.value < top - height * SLACK || p.value > top + height * (1 + SLACK)
    ));
    if (outside.length) {
      const some = outside.slice(0, 4).map((p) => `<${p.tag} ${p.name}="${p.raw}">`).join(', ');
      problems.push(`${outside.length} coordinate(s) fall outside the ${width}x${height} viewBox and will be clipped -- ${some}. `
        + 'Scale every value into the plot area: x = left + (index / (count - 1)) * plotWidth, '
        + 'y = bottom - ((value - min) / (max - min)) * plotHeight, and guard max === min.');
    }
  }
  return problems;
}

/** What is wrong with what a chart transform returned. */
export function checkPlot(outputs: Record<string, unknown>): string[] {
  const value = outputs.value;
  if (typeof value === 'string') {
    if (/^\s*<svg[\s>]/i.test(value)) return checkDrawing(value);
    return ['"value" is a string but not an SVG document. Return either a list of points, or a string that starts with "<svg".'];
  }
  if (Array.isArray(value)) {
    const bad = value.findIndex((item) => {
      if (typeof item === 'number') return !Number.isFinite(item);
      const point = item as { value?: unknown; y?: unknown } | null;
      const number = point?.value ?? point?.y;
      return typeof number !== 'number' || !Number.isFinite(number);
    });
    return bad === -1 ? [] : [
      `Point ${bad} is ${JSON.stringify(value[bad]).slice(0, 80)}, which cannot be charted: every point must be a finite number, `
      + 'or {"label": string, "value": number}. Convert with Number() and drop rows where that is not a number.',
    ];
  }
  return [`"value" is ${value === null ? 'null' : typeof value}. Return a list of points, or an SVG document as a string.`];
}
