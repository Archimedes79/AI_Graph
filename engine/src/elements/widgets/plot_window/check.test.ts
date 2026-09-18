import { describe, it, expect } from 'vitest';
import { checkDrawing, checkPlot } from './check.ts';

const svg = (body: string, attributes = 'viewBox="0 0 400 240"') =>
  `<svg width="100%" height="100%" ${attributes} xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

describe('looking at a drawing without a screen', () => {
  it('has nothing to say about a drawing that is fine', () => {
    expect(checkDrawing(svg('<line x1="46" y1="210" x2="386" y2="210" stroke="currentColor"/><rect x="60" y="80" width="30" height="130"/>')))
      .toEqual([]);
  });

  it('finds the label that was used as a number', () => {
    // "08:00" * something: what two different small models both produced.
    const [problem] = checkDrawing(svg('<circle cx="NaN" cy="120" r="3"/>'));
    expect(problem).toMatch(/not numbers/);
    expect(problem).toMatch(/cx="NaN"/);
    expect(problem).toMatch(/INDEX/);
  });

  it('finds what would be clipped, and says where', () => {
    const [problem] = checkDrawing(svg('<rect x="10" y="10" width="5" height="5"/><text x="520" y="30">late</text>'));
    expect(problem).toMatch(/1 coordinate\(s\) fall outside the 400x240 viewBox/);
    expect(problem).toMatch(/<text x="520">/);
  });

  it('lets a stroke or an anchor overhang a little', () => {
    expect(checkDrawing(svg('<rect x="-4" y="236" width="5" height="5"/><text x="404" y="120">edge</text>'))).toEqual([]);
  });

  it('asks for a viewBox, because the block is resizable', () => {
    expect(checkDrawing(svg('<rect x="1" y="1" width="5" height="5"/>', 'width="400" height="240"'))[0]).toMatch(/no viewBox/);
  });

  it('notices an empty frame', () => {
    expect(checkDrawing(svg('<text x="20" y="20">Chart</text>'))[0]).toMatch(/no marks at all/);
  });

  it('does not judge colour: red may be exactly what was asked for', () => {
    expect(checkDrawing(svg('<rect x="0" y="0" width="400" height="240" fill="#fff"/><line x1="46" y1="60" x2="386" y2="60" stroke="red"/>')))
      .toEqual([]);
  });
});

describe('what a chart transform returned', () => {
  it('accepts points', () => {
    expect(checkPlot({ value: [1, 2, 3] })).toEqual([]);
    expect(checkPlot({ value: [{ label: 'a', value: 2 }, { x: 'b', y: 3 }] })).toEqual([]);
    expect(checkPlot({ value: [] })).toEqual([]);
  });

  it('names the point that cannot be charted', () => {
    expect(checkPlot({ value: [{ label: 'a', value: 1 }, { label: 'b', value: '12' }] })[0]).toMatch(/Point 1 is/);
  });

  it('says what to return when it got neither', () => {
    expect(checkPlot({ value: null })[0]).toMatch(/list of points, or an SVG/);
    expect(checkPlot({ value: 'see above' })[0]).toMatch(/not an SVG document/);
  });
});
