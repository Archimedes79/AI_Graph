import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

const port = (id: string, kind: 'input' | 'output', dataType = 'any') =>
  ({ id, name: id, kind, data_type: dataType, multi: false, required: false, description: '' });

/** What a command prints: stdout, which is the result, and stderr, which is everything said about it. */
async function printed(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const writes: string[] = [];
  const said: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { said.push(String(chunk)); return true; });
  try {
    return { code: await main(argv), out: writes.join(''), err: said.join('') };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

/**
 * One node by itself, from a command line: what its panel tries, with no
 * editor anywhere -- the node's example, and the files its example reads.
 */
describe('run-node', () => {
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

  it('holds a node to no output.js that cannot be read: run-node and test fail, and say why, rather than "fits"', async () => {
    const dir = await project({
      input_definition: 'module.exports = { "csv": "name\\nAda\\nBo" };\n',
      output_definition: 'module.exports = { "rows": 2, };\n',
    });
    try {
      const alone = await printed(['run-node', dir, 'count']);
      expect(alone.code).toBe(1);
      expect(JSON.parse(alone.out)).toMatchObject({ status: 'fail', outputs: { rows: 2 }, held: false, details: [expect.stringMatching(/^output\.js cannot be read: /)] });
      const tested = await printed(['test', dir]);
      expect(tested.code).toBe(1);
      expect(tested.out).toMatch(/^✗ .* count: is held to no output\.js\n {4}output\.js cannot be read: its example after module\.exports is not plain JSON/);
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

/** A clock on the command line: the rule a served tool's clock keeps too. */
describe('--every', () => {
  it('runs one graph round after round: what a round leaves in a data node is what the next starts from', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-every-'));
    await writeProject(dir, parseGraph({
      metadata: { name: 'Counter' },
      nodes: [
        {
          id: 'count', node_type: 'data', label: 'Count', inputs: [port('input', 'input')], outputs: [port('output', 'output')],
          config: { data_format: 'structure', data_value: 0 },
        },
        {
          id: 'add', node_type: 'code', label: 'Add one', inputs: [port('n', 'input')], outputs: [port('next', 'output')],
          config: { code: 'function run(i) { return { next: i.n + 1 }; }' },
        },
      ],
      edges: [
        { id: 'a', source_node_id: 'count', source_port_id: 'output', target_node_id: 'add', target_port_id: 'n' },
        { id: 'b', source_node_id: 'add', source_port_id: 'next', target_node_id: 'count', target_port_id: 'input' },
      ],
    }));
    try {
      const { code, out } = await printed([dir, '--every', '0.01', '--limit', '3']);
      expect(code).toBe(0);
      const rounds = out.trim().split(/\n(?=\{)/).map((round) => JSON.parse(round) as { node_results: { node_id: string; outputs: { next?: number } }[] });
      expect(rounds.map((round) => round.node_results.find((result) => result.node_id === 'add')?.outputs.next)).toEqual([1, 2, 3]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('says a round that could not even start, and goes on to the next', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-every-'));
    const graph = join(dir, 'loop.json');
    // Two nodes feeding each other and nothing that remembers: no round can be put in order.
    const code = (id: string) => ({ id, node_type: 'code', inputs: [port('in', 'input')], outputs: [port('out', 'output')], config: { code: 'function run(i) { return { out: i.in }; }' } });
    await writeFile(graph, JSON.stringify({
      metadata: { name: 'Loop' },
      nodes: [code('a'), code('b')],
      edges: [
        { id: 'ab', source_node_id: 'a', source_port_id: 'out', target_node_id: 'b', target_port_id: 'in' },
        { id: 'ba', source_node_id: 'b', source_port_id: 'out', target_node_id: 'a', target_port_id: 'in' },
      ],
    }));
    try {
      const { code: exit, err } = await printed([graph, '--every', '0.01', '--limit', '2']);
      expect(exit).toBe(1);
      expect(err.match(/This run failed: .*cycle/g)).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** A server started as a person or a launcher starts one: its own process, told nothing opens a browser. */
function started(args: string[], env: NodeJS.ProcessEnv = { ...process.env, AI_GRAPH_NO_BROWSER: '1' }, cwd?: string) {
  const child = spawn(process.execPath, [resolve(__dirname, '..', 'main.ts'), ...args], {
    // Its own settings file, none: what a server says at start must not come from this machine's.
    env: { ...env, AI_GRAPH_SETTINGS: join(tmpdir(), 'ai-graph-no-settings.json') }, cwd, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let said = '';
  child.stderr.on('data', (chunk: Buffer) => { said += chunk.toString(); });
  /** Until it serves, or ends, or *ms* have gone by. */
  const up = async (ms = 10_000): Promise<void> => {
    for (const until = Date.now() + ms; Date.now() < until && !said.includes('Serving on') && child.exitCode === null;) {
      await new Promise((wake) => setTimeout(wake, 100));
    }
  };
  return { child, said: () => said, up };
}

const freePort = () => new Promise<number>((found) => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port: taken } = probe.address() as { port: number };
    probe.close(() => found(taken));
  });
});

const MINIMAL = resolve(__dirname, '..', '..', 'fixtures', 'minimal.json');

describe('--serve and --editor, as they are started', () => {
  /**
   * A container has nothing to open a browser in -- no `xdg-open` in an Alpine
   * image -- and neither has many a server a bundle is started on. A missing
   * opener is said as an 'error' event, not thrown, and unheard it ended the
   * process right after "Serving on".
   */
  it('serves where nothing can open a browser', async () => {
    const port = await freePort();
    // No PATH: whatever opens a browser on this machine cannot be found.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(PATH|AI_GRAPH_NO_BROWSER)$/i.test(name)));
    const server = started([MINIMAL, '--serve', '--port', String(port)], { ...env, PATH: '' });
    try {
      await server.up();
      await new Promise((wake) => setTimeout(wake, 500));
      expect(server.child.exitCode, server.said()).toBeNull();
      expect((await fetch(`http://127.0.0.1:${port}/api/runtime/graph`)).status).toBe(200);
    } finally {
      server.child.kill();
    }
  }, 30_000);

  it('says a graph that was named and is not there, rather than serving nothing', async () => {
    const server = started([join(tmpdir(), 'no-such-graph.json'), '--serve', '--port', String(await freePort())]);
    try {
      await server.up();
      expect(server.said()).not.toContain('Serving on');
      expect(server.said()).toMatch(/Nothing at .*no-such-graph.json/);
    } finally {
      server.child.kill();
    }
  }, 30_000);

  it('as the editor, serves no graph.json it was started beside -- only one it is given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-editor-'));
    await writeFile(join(dir, 'graph.json'), await readFile(MINIMAL, 'utf8'));
    const port = await freePort();
    const beside = started(['--editor', dir, '--port', String(port)], undefined, dir);
    try {
      await beside.up();
      expect((await fetch(`http://127.0.0.1:${port}/api/runtime/graph`)).status).toBe(404);
    } finally {
      beside.child.kill();
    }
    const other = await freePort();
    const given = started(['graph.json', '--editor', dir, '--port', String(other)], undefined, dir);
    try {
      await given.up();
      expect((await fetch(`http://127.0.0.1:${other}/api/runtime/graph`)).status).toBe(200);
    } finally {
      given.child.kill();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);
});
