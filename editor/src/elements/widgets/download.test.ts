import { describe, it, expect } from 'vitest';
import { csvText, fileName, standaloneSvg } from './download';

describe('the name a block\'s file is saved under', () => {
  it('is the block\'s label, with its kind\'s extension', () => {
    expect(fileName('Monthly sales', 'chart', 'svg')).toBe('Monthly sales.svg');
  });

  it('drops what a file system refuses in a name', () => {
    expect(fileName('Sales / Costs: 2026?', 'chart', 'svg')).toBe('Sales Costs 2026.svg');
  });

  it('is what the block is, for a block with no label or only refused characters in it', () => {
    expect(fileName('', 'output', 'txt')).toBe('output.txt');
    expect(fileName(undefined, 'table', 'csv')).toBe('table.csv');
    expect(fileName(' ?* ', 'chart', 'svg')).toBe('chart.svg');
  });
});

describe('a table saved as CSV', () => {
  it('is its header and its rows, a line each, every line ending in CRLF', () => {
    expect(csvText(['city', 'people'], [['Oslo', '700000'], ['Bergen', '290000']]))
      .toBe('city,people\r\nOslo,700000\r\nBergen,290000\r\n');
  });

  it('quotes a cell holding a comma, a quote or a line break, and doubles a quote in it', () => {
    expect(csvText(['note'], [['a, b'], ['say "hi"'], ['two\nlines'], ['plain']]))
      .toBe('note\r\n"a, b"\r\n"say ""hi"""\r\n"two\nlines"\r\nplain\r\n');
  });
});

describe('a chart saved as SVG', () => {
  const scheme: Record<string, string> = { '--ui-text': '#1f2937', '--plot-1': ' #15803d' };
  const resolve = (name: string) => scheme[name] ?? '';

  it('is a file of its own: the SVG namespace, and the size it was drawn at for the page\'s 100%', () => {
    expect(standaloneSvg('<svg width="100%" height="100%" viewBox="0 0 10 10"><circle r="4"/></svg>', { width: 400, height: 200 }, resolve))
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 10 10"><circle r="4"/></svg>');
  });

  it('has the colours of the scheme it was drawn in, which the page lent it as variables', () => {
    const svg = standaloneSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><text fill="var(--ui-text, #e2e8f0)">a</text>'
        + '<rect style="fill: var(--plot-1, #6366f1);"/><line stroke="var(--ui-line, #2d3148)"/>'
        + '<g style="background: var(--ui-raise, rgba(255,255,255,0.03))"/><path fill="var(--own)"/></svg>',
      { width: 10, height: 10 },
      resolve,
    );
    expect(svg).toContain('fill="#1f2937"');
    expect(svg).toContain('style="fill: #15803d;"');
    // Not lent by the page: its fallback, as CSS would take it.
    expect(svg).toContain('stroke="#2d3148"');
    expect(svg).toContain('background: rgba(255,255,255,0.03)');
    // Nothing to fall back to: left as it was.
    expect(svg).toContain('fill="var(--own)"');
    expect(svg.match(/xmlns=/g)).toHaveLength(1);
  });

  it('stands on the colour it stood on, drawn first', () => {
    expect(standaloneSvg('<svg viewBox="0 0 4 4"><circle r="1"/></svg>', { width: 4, height: 4, background: 'rgb(15, 17, 23)' }, resolve))
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4">'
        + '<rect width="100%" height="100%" fill="rgb(15, 17, 23)"/><circle r="1"/></svg>');
  });
});
