import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGraph } from '../graph.ts';
import { writeProject } from '../project/folder.ts';
import { main, parseArgs, parseInterval } from './cli.ts';

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

/**
 * One node by itself, from a command line: what its dialog tries, with no
 * editor anywhere -- the node's example, and the files its example reads.
 */
describe('run-node', () => {
  const port = (id: string, kind: 'input' | 'output', dataType = 'any') =>
    ({ id, name: id, kind, data_type: dataType, multi: false, required: false, description: '' });

  async function project(config: Record<string, unknown>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-run-node-'));
    await writeProject(dir, parseGraph({
      metadata: { name: 'Rows' },
      nodes: [{
        id: 'count', node_type: 'code', label: 'Count', inputs: [port('csv', 'input', 'file_path')], outputs: [port('rows', 'output')],
        config: { code: 'function run(i) { return { rows: i.csv.trim().split("\\n").length - 1 }; }', ...config },
      }],
      edges: [],
    }));
    return dir;
  }

  async function printed(argv: string[]): Promise<{ code: number; out: string }> {
    const writes: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      return { code: await main(argv), out: writes.join('') };
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  }

  it('runs a node once on the example in its input.js -- a file\'s text, already read -- and holds it to its output.js', async () => {
    const dir = await project({
      input_definition: '/** @typedef {Object} Input @property {string} csv a CSV\'s text */\nmodule.exports = { "csv": "name\\nAda\\nBo" };\n',
      output_definition: '/** @typedef {Object} Output @property {number} rows how many rows */\nmodule.exports = { "rows": 2 };\n',
    });
    try {
      const { code, out } = await printed(['run-node', dir, 'count']);
      expect(code).toBe(0);
      expect(JSON.parse(out)).toMatchObject({ status: 'pass', outputs: { rows: 2 }, held: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('runs a node of another kind -- one with no input.js -- on what the nodes feeding it produce', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-run-node-'));
    await writeProject(dir, parseGraph({
      metadata: { name: 'Say' },
      nodes: [
        { id: 'said', node_type: 'input', label: 'Said', outputs: [port('output', 'output', 'text')], config: { value: 'hello' } },
        { id: 'result', node_type: 'output', label: 'Result', inputs: [port('value', 'input')], config: {} },
      ],
      edges: [{ id: 'e', source_node_id: 'said', source_port_id: 'output', target_node_id: 'result', target_port_id: 'value' }],
    }));
    try {
      const { code, out } = await printed(['run-node', dir, 'result']);
      expect(code).toBe(0);
      expect(JSON.parse(out)).toMatchObject({ status: 'success', inputs: { value: 'hello' } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('says what to do for a node with no example', async () => {
    const dir = await project({});
    try {
      const { code, out } = await printed(['run-node', dir, 'count']);
      expect(code).toBe(1);
      expect(JSON.parse(out).details).toEqual(['It has no input.js, so there is nothing to try it on: write one with ✨ Input.']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
