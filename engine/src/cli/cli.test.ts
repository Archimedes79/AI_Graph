import { describe, it, expect } from 'vitest';
import { parseArgs, parseInterval } from './cli.ts';

describe('parseInterval', () => {
  it('reads a bare number as seconds', () => {
    expect(parseInterval('45')).toBe(45);
  });

  it('reads the suffixes nobody should have to multiply out', () => {
    expect(parseInterval('30s')).toBe(30);
    expect(parseInterval('5m')).toBe(300);
    expect(parseInterval('2h')).toBe(7200);
    expect(parseInterval('1d')).toBe(86_400);
  });

  it('refuses what it cannot read, rather than guessing', () => {
    expect(() => parseInterval('soon')).toThrow(/Not an interval/);
    expect(() => parseInterval('0')).toThrow(/greater than zero/);
  });
});

describe('parseArgs', () => {
  it('takes the graph, and repeats --inputs into a map', () => {
    const options = parseArgs(['g.json', '--inputs', 'a=1', '--inputs', 'b=2']);
    expect(options.graphPath).toBe('g.json');
    expect(options.inputs).toEqual({ a: '1', b: '2' });
  });

  it('keeps the rest of a value containing an equals sign', () => {
    // A path or a query string is a perfectly ordinary answer.
    expect(parseArgs(['g.json', '--inputs', 'q=a=b']).inputs).toEqual({ q: 'a=b' });
  });

  it('defaults to graph.json, the way a bundle is laid out', () => {
    expect(parseArgs([]).graphPath).toBe('graph.json');
  });

  it('reads --mcp with no graph at all, and keeps its root out of the graph path', () => {
    const options = parseArgs(['--mcp', '--mcp-root', './project']);
    expect(options.mcp).toBe(true);
    expect(options.mcpRoot).toBe('./project');
    // The folder is the flag's value, not a positional: it must not become the graph.
    expect(options.graphPath).toBe('graph.json');
  });

  it('is not an MCP server unless asked', () => {
    expect(parseArgs(['g.json']).mcp).toBeUndefined();
  });

  it('refuses a --limit that is not a whole number of runs', () => {
    expect(parseArgs(['g.json', '--limit', '3']).limit).toBe(3);
    for (const given of ['three', '', '0', '1.5']) {
      expect(() => parseArgs(['g.json', '--limit', given]), given).toThrow(/--limit wants a whole number/);
    }
  });

  it('refuses a flag it does not know, rather than reading it as the graph or dropping it', () => {
    expect(() => parseArgs(['--ai-provider', 'openai', 'g.json'])).toThrow(/Unknown option "--ai-provider"/);
    expect(() => parseArgs(['g.json', '--ai-force'])).toThrow(/Unknown option "--ai-force"/);
  });
});
