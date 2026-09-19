import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AiService, Runtime } from '../../elements/Runtime.ts';
import { mcpToolService } from '../../ai/mcp.ts';
import { createGraphTools, serveStdio, type GraphTools, type Problem } from './mcpServer.ts';

const MAIN = resolve(__dirname, '..', '..', 'main.ts');

// ---------------------------------------------------------------------------
// Graphs small enough to read
// ---------------------------------------------------------------------------

const port = (id: string, kind: 'input' | 'output') =>
  ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '' });

const textInput = (id: string, value = 'hello') => ({
  id, node_type: 'input', label: id, description: '', position: { x: 0, y: 0 },
  inputs: [], outputs: [port('output', 'output')], config: { input_mode: 'text', value },
});

const code = (id: string, body = 'function run(inputs) { return { out: inputs.in }; }') => ({
  id, node_type: 'code', label: id, description: '', position: { x: 0, y: 0 },
  inputs: [port('in', 'input')], outputs: [port('out', 'output')], config: { code: body } as Record<string, unknown>,
});

const output = (id: string) => ({
  id, node_type: 'output', label: id, description: '', position: { x: 0, y: 0 },
  inputs: [port('value', 'input')], outputs: [], config: { write_mode: 'window', output_label: 'Result' },
});

const page = (id: string, blocks: Record<string, unknown>[]) => ({
  id, node_type: 'gui', label: id, description: '', position: { x: 0, y: 0 },
  inputs: [], outputs: [], config: { gui_widgets: blocks },
});

const edge = (id: string, from: string, to: string) => {
  const [source_node_id, source_port_id] = from.split('.');
  const [target_node_id, target_port_id] = to.split('.');
  return { id, source_node_id, source_port_id, target_node_id, target_port_id };
};

const graphOf = (nodes: unknown[], edges: unknown[] = [], name = 'Test') =>
  ({ metadata: { name, description: `${name}, described` }, nodes, edges });

/** The smallest graph with nothing wrong with it. */
const hello = (value = 'hello') =>
  graphOf([textInput('greeting', value), output('result')], [edge('e1', 'greeting.output', 'result.value')], 'Hello');

// ---------------------------------------------------------------------------
// A machine made of fakes
// ---------------------------------------------------------------------------

const replying = (reply: string | Error): AiService => ({
  async complete() {
    if (reply instanceof Error) throw reply;
    return reply;
  },
});

const fenced = (graph: unknown, explanation = 'It greets.'): string =>
  `\`\`\`json\n${JSON.stringify(graph, null, 2)}\n\`\`\`\n${explanation}`;

/** What the code runner was last handed, so a test can see which body ran. */
let ranBody = '';

const fakeRuntime = (): Runtime => ({
  files: {
    resolve: (path) => path,
    exists: async () => false,
    read: async () => { throw new Error('no files in this test'); },
    write: async () => { throw new Error('no files in this test'); },
    list: async () => [],
  },
  code: {
    async run(body, inputs) {
      ranBody = body;
      return { out: `ran on ${String(inputs.in)}` };
    },
  },
  ai: replying('unused'),
});

let root: string;
let outside: string;

const toolsWith = (overrides: Partial<Parameters<typeof createGraphTools>[0]> = {}): GraphTools => createGraphTools({
  root,
  ai: replying(fenced(hello())),
  runtime: fakeRuntime,
  target: async () => ({ provider: 'fake', model: 'fake-1' }),
  ...overrides,
});

const answer = async (tools: GraphTools, name: string, args: Record<string, unknown> = {}) => {
  const result = await tools.call(name, args);
  let parsed: any;
  try { parsed = JSON.parse(result.text); } catch { parsed = undefined; }
  return { ...result, json: parsed };
};

const problemsOf = async (graph: unknown): Promise<Problem[]> =>
  (await answer(toolsWith(), 'validate_graph', { graph: graph as Record<string, unknown> })).json.problems;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ai-graph-mcp-'));
  outside = await mkdtemp(join(tmpdir(), 'ai-graph-mcp-outside-'));
  ranBody = '';
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

describe('authoring_guide', () => {
  it('hands over the authoring prompt and what this engine actually has', async () => {
    const { text, isError } = await toolsWith().call('authoring_guide', {});
    expect(isError).toBeUndefined();
    expect(text).toContain('Graph DSL');
    expect(text).toContain('__run');
    expect(text).toMatch(/Node types this engine runs: .*\bgui\b/);
    expect(text).toMatch(/Block kinds a gui node can hold: .*\bbutton\b/);
  });
});

describe('generate_graph', () => {
  it('generates, validates, saves, and the saved file is a graph the other tools can read', async () => {
    const tools = toolsWith();
    const made = await answer(tools, 'generate_graph', { description: 'greet the world', save_as: 'made/hello.json' });
    expect(made.isError).toBeUndefined();
    expect(made.json.saved).toBe('made/hello.json');
    expect(made.json.problems).toEqual([]);
    expect(made.json.explanation).toBe('It greets.');
    expect(made.json.graph.nodes.map((node: { id: string }) => node.id)).toEqual(['greeting', 'result']);

    const onDisk = JSON.parse(await readFile(join(root, 'made', 'hello.json'), 'utf8'));
    expect(onDisk.metadata.name).toBe('Hello');
    expect((await answer(tools, 'validate_graph', { path: 'made/hello.json' })).json).toEqual({ valid: true, problems: [] });
    expect((await answer(tools, 'list_graphs')).json.graphs).toEqual([
      { path: 'made/hello.json', name: 'Hello', description: 'Hello, described', nodes: 2 },
    ]);
  });

  it('returns the graph without writing anything when no save_as is given', async () => {
    const made = await answer(toolsWith(), 'generate_graph', { description: 'greet the world' });
    expect(made.json.graph.edges).toHaveLength(1);
    expect(made.json.saved).toBeUndefined();
    expect((await answer(toolsWith(), 'list_graphs')).json.graphs).toEqual([]);
  });

  it('does not save a generated graph that has problems, and says which', async () => {
    const broken = graphOf([textInput('greeting'), code('work')], [edge('e1', 'greeting.content', 'work.in')]);
    const made = await answer(toolsWith({ ai: replying(fenced(broken)) }), 'generate_graph', { description: 'x', save_as: 'broken.json' });
    expect(made.json.saved).toBe(false);
    expect(made.json.problems.length).toBeGreaterThan(0);
    expect(made.json.graph.nodes).toHaveLength(2);
    expect(existsSync(join(root, 'broken.json'))).toBe(false);
  });

  it('says plainly when no model is configured, and names the way round it', async () => {
    const made = await toolsWith({ target: async () => ({ provider: '', model: '' }) }).call('generate_graph', { description: 'x' });
    expect(made.isError).toBe(true);
    expect(made.text).toMatch(/No generation model is configured/);
    expect(made.text).toMatch(/authoring_guide/);
    expect(made.text).toMatch(/save_graph/);
  });

  it("passes a provider's error through, and never a key with it", async () => {
    const failing = new Error('401 from api.example: invalid key hunter2-hunter2-hunter2, also sk-abcdefghijklmnopqrstuvwxyz012345');
    const made = await toolsWith({ ai: replying(failing), secrets: () => ['hunter2-hunter2-hunter2'] })
      .call('generate_graph', { description: 'x' });
    expect(made.isError).toBe(true);
    expect(made.text).toContain('401 from api.example');
    expect(made.text).toContain('fake / fake-1');
    expect(made.text).not.toContain('hunter2');
    expect(made.text).not.toContain('sk-abcdefghij');
    expect(made.text).toMatch(/authoring_guide/);
  });

  it('refuses a bad save_as before the model is asked', async () => {
    let asked = 0;
    const counting: AiService = { async complete() { asked += 1; return fenced(hello()); } };
    const made = await toolsWith({ ai: counting }).call('generate_graph', { description: 'x', save_as: '../escape.json' });
    expect(made.isError).toBe(true);
    expect(asked).toBe(0);
  });

  it('bounds what comes in', async () => {
    const long = await toolsWith().call('generate_graph', { description: 'x'.repeat(20_001) });
    expect(long.isError).toBe(true);
    expect(long.text).toMatch(/limit is 20000/);

    const heavy = graphOf([code('big', `function run() { return { out: "${'x'.repeat(2 * 1024 * 1024)}" }; }`), output('result')]);
    const saved = await toolsWith().call('save_graph', { path: 'big.json', graph: heavy });
    expect(saved.isError).toBe(true);
    expect(saved.text).toMatch(/larger than 2 MB/);
    expect(existsSync(join(root, 'big.json'))).toBe(false);
  });
});

describe('validate_graph', () => {
  it('finds nothing wrong with a graph that has nothing wrong with it', async () => {
    expect(await problemsOf(hello())).toEqual([]);
  });

  it('wants one of graph and path, not both and not neither', async () => {
    expect((await toolsWith().call('validate_graph', {})).isError).toBe(true);
    expect((await toolsWith().call('validate_graph', { graph: hello(), path: 'x.json' })).isError).toBe(true);
  });

  it('reports a document that is not a graph as a finding, not a failure', async () => {
    const checked = await answer(toolsWith(), 'validate_graph', { graph: { name: 'not-a-graph' } });
    expect(checked.isError).toBeUndefined();
    expect(checked.json.valid).toBe(false);
    expect(checked.json.problems[0].problem).toMatch(/"nodes" array/);

    const malformed = await answer(toolsWith(), 'validate_graph', { graph: graphOf([page('panel', [null as never]), output('r')]) });
    expect(malformed.json.problems[0].problem).toMatch(/gui_widgets must be a block object/);
  });

  it('names an unknown node_type and says what to use instead', async () => {
    const [problem] = await problemsOf(graphOf([{ ...code('merge'), node_type: 'merge' }, output('result')]));
    expect(problem.where).toBe('node "merge"');
    expect(problem.problem).toMatch(/Unknown node_type "merge"/);
    expect(problem.fix).toMatch(/input, ai, code, data, output, gui/);
  });

  it('names a duplicated node id', async () => {
    const problems = await problemsOf(graphOf([textInput('twin'), textInput('twin'), output('result')]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ where: 'node "twin"', problem: expect.stringMatching(/More than one node/) });
  });

  it('names an edge whose endpoint is a node that is not there', async () => {
    const problems = await problemsOf(graphOf([textInput('greeting'), output('result')], [edge('e1', 'ghost.output', 'result.value')]));
    expect(problems).toHaveLength(1);
    expect(problems[0].where).toBe('edge "e1"');
    expect(problems[0].problem).toMatch(/source is node "ghost"/);
    expect(problems[0].fix).toMatch(/"greeting", "result"/);
  });

  it('names an edge to a port the node does not declare, and lists the ones it has', async () => {
    const problems = await problemsOf(graphOf(
      [textInput('greeting'), code('work'), output('result')],
      [edge('e1', 'greeting.output', 'work.text'), edge('e2', 'work.out', 'result.value')],
    ));
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toMatch(/target port "text" is not an input of node "work"/);
    expect(problems[0].fix).toMatch(/"in"/);
  });

  it('checks input and gui nodes against the ports the engine derives, not the ones the document claims', async () => {
    // The mistake the authoring prompt warns about: a text input has `output`,
    // whatever the document declares, and a page's ports come from its blocks.
    const lying = { ...textInput('greeting'), outputs: [port('content', 'output')] };
    const panel = { ...page('panel', [{ id: 'shown', kind: 'text_io', mode: 'output', label: 'Shown' }]), inputs: [port('display', 'input')] };
    const problems = await problemsOf(graphOf([lying, panel], [
      edge('e1', 'greeting.content', 'panel.shown_in'),
      edge('e2', 'greeting.output', 'panel.display'),
    ]));
    expect(problems.map((problem) => problem.where)).toEqual(['edge "e1"', 'edge "e2"']);
    expect(problems[0].fix).toMatch(/derived from its settings.*"output"/);
    expect(problems[1].fix).toMatch(/derived from its settings.*"shown_in"/);

    expect(await problemsOf(graphOf([lying, panel], [edge('e1', 'greeting.output', 'panel.shown_in')]))).toEqual([]);
  });

  it('accepts __run on any node, and error on a node told to catch its failures', async () => {
    const catching = code('work');
    catching.config.catch_errors = true;
    const panel = page('panel', [{ id: 'go', kind: 'button', label: 'Go' }, { id: 'why', kind: 'text_io', mode: 'output', label: 'Why' }]);
    expect(await problemsOf(graphOf([panel, textInput('greeting'), catching], [
      edge('e1', 'panel.go_out', 'work.__run'),
      edge('e2', 'greeting.output', 'work.in'),
      edge('e3', 'work.error', 'panel.why_in'),
    ]))).toEqual([]);

    // Without being told to catch, there is no such port.
    const problems = await problemsOf(graphOf([textInput('greeting'), code('work'), output('result')], [
      edge('e1', 'greeting.output', 'work.in'), edge('e2', 'work.error', 'result.value'),
    ]));
    expect(problems.map((problem) => problem.where)).toEqual(['edge "e2"']);
  });

  it('names the nodes of a cycle nothing remembers, and lets a loop through a page stand', async () => {
    const problems = await problemsOf(graphOf(
      [textInput('greeting'), code('a'), code('b'), output('result')],
      [edge('e1', 'a.out', 'b.in'), edge('e2', 'b.out', 'a.in'), edge('e3', 'b.out', 'result.value')],
    ));
    expect(problems).toHaveLength(1);
    expect(problems[0].where).toBe('nodes "a", "b"');
    expect(problems[0].fix).toMatch(/remembers/);

    const panel = page('panel', [{ id: 'box', kind: 'text_io', mode: 'input', label: 'Box' }, { id: 'shown', kind: 'text_io', mode: 'output', label: 'Shown' }]);
    expect(await problemsOf(graphOf([panel, code('work')], [
      edge('e1', 'panel.box_out', 'work.in'), edge('e2', 'work.out', 'panel.shown_in'),
    ]))).toEqual([]);
  });

  it('names a code node with nothing to run', async () => {
    const problems = await problemsOf(graphOf([code('empty', '  '), output('result')], [edge('e1', 'empty.out', 'result.value')]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ where: 'node "empty"', problem: expect.stringMatching(/no config\.code/) });
  });

  it('names a graph that shows nobody its answer', async () => {
    const problems = await problemsOf(graphOf([textInput('greeting'), code('work')], [edge('e1', 'greeting.output', 'work.in')]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ where: 'graph', problem: expect.stringMatching(/Nothing a person can see/) });
  });

  it('names a block kind no page has', async () => {
    const problems = await problemsOf(graphOf([page('panel', [{ id: 'dial', kind: 'gauge', label: 'Dial' }])]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ where: 'node "panel", block "dial"', problem: 'Unknown block kind "gauge".' });
  });
});

describe('save_graph', () => {
  it('writes pretty JSON, and replaces a graph with a graph', async () => {
    const tools = toolsWith();
    const first = await answer(tools, 'save_graph', { path: 'hello.json', graph: hello('one') });
    expect(first.json).toEqual({ saved: 'hello.json', nodes: 2, edges: 1 });
    const text = await readFile(join(root, 'hello.json'), 'utf8');
    expect(text).toContain('\n  "nodes": [');

    expect((await tools.call('save_graph', { path: 'hello.json', graph: hello('two') })).isError).toBeUndefined();
    expect(JSON.parse(await readFile(join(root, 'hello.json'), 'utf8')).nodes[0].config.value).toBe('two');
  });

  it('refuses a graph with problems, returns them, and writes nothing', async () => {
    const saved = await answer(toolsWith(), 'save_graph', { path: 'bad.json', graph: graphOf([code('alone')]) });
    expect(saved.isError).toBe(true);
    expect(saved.json.saved).toBe(false);
    expect(saved.json.problems[0].problem).toMatch(/Nothing a person can see/);
    expect(existsSync(join(root, 'bad.json'))).toBe(false);
  });

  it('never overwrites a file that is not a graph', async () => {
    // The point of rule 3: `save_graph` is not "write any JSON file".
    const manifest = '{ "name": "somebody-elses-project", "version": "1.0.0" }\n';
    await writeFile(join(root, 'package.json'), manifest);
    await writeFile(join(root, 'notes.json'), 'not even json');

    for (const path of ['package.json', 'notes.json']) {
      const saved = await toolsWith().call('save_graph', { path, graph: hello() });
      expect(saved.isError).toBe(true);
      expect(saved.text).toMatch(/already exists and is not a graph/);
    }
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(manifest);
    expect(await readFile(join(root, 'notes.json'), 'utf8')).toBe('not even json');
  });

  it('saves into a project the way the editor does: the code to its file, the wiring to graph.json', async () => {
    await mkdir(join(root, 'proj', 'nodes'), { recursive: true });
    const saved = await toolsWith().call('save_graph', {
      path: 'proj/graph.json', graph: graphOf([textInput('greeting'), code('work'), output('result')],
        [edge('e1', 'greeting.output', 'work.in'), edge('e2', 'work.out', 'result.value')]),
    });
    expect(saved.isError).toBeUndefined();
    expect(await readFile(join(root, 'proj', 'nodes', 'work', 'code.js'), 'utf8')).toContain('function run');
    const wiring = JSON.parse(await readFile(join(root, 'proj', 'graph.json'), 'utf8'));
    expect(wiring.nodes[1].config).not.toHaveProperty('code');
    // And what it saved is what it reads back.
    const ran = await answer(toolsWith(), 'run_graph', { path: 'proj/graph.json' });
    expect(ran.json.status).toBe('success');
    expect(ranBody).toContain('function run');
  });
});

describe('confinement', () => {
  const refused = async (tools: GraphTools, path: string, pattern: RegExp): Promise<void> => {
    for (const [name, args] of [
      ['validate_graph', { path }],
      ['run_graph', { path }],
      ['save_graph', { path, graph: hello() }],
      ['generate_graph', { description: 'x', save_as: path }],
    ] as const) {
      const result = await tools.call(name, args);
      expect(result.isError, `${name} ${path}`).toBe(true);
      expect(result.text, `${name} ${path}`).toMatch(pattern);
    }
  };

  it('refuses every way out of the root', async () => {
    const tools = toolsWith();
    await writeFile(join(outside, 'secret.json'), JSON.stringify(hello('a secret')));

    await refused(tools, '../escape.json', /outside the folder/);
    await refused(tools, 'graphs/../../escape.json', /outside the folder/);
    await refused(tools, join(outside, 'secret.json'), /outside the folder/);
    // The sibling whose name merely starts with the root's.
    await refused(tools, `${root}-old/x.json`, /outside the folder/);
    if (process.platform === 'win32') {
      await refused(tools, 'Z:\\elsewhere\\x.json', /outside the folder/);
      await refused(tools, '\\\\server\\share\\x.json', /outside the folder/);
      await refused(tools, 'notes.exe:x.json', /cannot be trusted/);
    }
    expect(existsSync(join(outside, 'escape.json'))).toBe(false);
    expect(existsSync(resolve(root, '..', 'escape.json'))).toBe(false);
  });

  it('follows a link before trusting it', async () => {
    await writeFile(join(outside, 'secret.json'), JSON.stringify(hello('a secret')));
    // A junction on Windows: the one kind of link that needs no privilege there.
    await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');

    const tools = toolsWith();
    await refused(tools, 'link/secret.json', /outside the folder/);
    await refused(tools, 'link/new.json', /outside the folder/);
    expect(existsSync(join(outside, 'new.json'))).toBe(false);
    expect(JSON.parse(await readFile(join(outside, 'secret.json'), 'utf8')).nodes[0].config.value).toBe('a secret');
    // And a listing does not wander through it either.
    expect((await answer(tools, 'list_graphs')).json.graphs).toEqual([]);
  });

  it('reads and writes .json and nothing else', async () => {
    const tools = toolsWith();
    await refused(tools, 'run.js', /not a \.json file/);
    await refused(tools, 'graph.json.', /not a \.json file/);
    await refused(tools, 'graph', /not a \.json file/);
  });

  it('stays out of dot-folders, node_modules and dist', async () => {
    const tools = toolsWith();
    await refused(tools, '.claude/settings.json', /dot-folder/);
    await refused(tools, '.git/x.json', /dot-folder/);
    await refused(tools, 'node_modules/pkg/package.json', /dot-folder/);
    await refused(tools, 'dist/x.json', /dot-folder/);
  });

  it('never opens the settings file, even when it would pass for a graph', async () => {
    // Shaped like a graph on purpose: the name is what keeps it shut, not the content.
    const settings = JSON.stringify({ api_keys: { openai: 'sk-live-THIS-MUST-NOT-LEAK-0123456789' }, nodes: [], edges: [] });
    await writeFile(join(root, 'ai-settings.json'), settings);
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'sub', 'AI-Settings.json'), settings);

    const tools = toolsWith();
    await refused(tools, 'ai-settings.json', /settings file/);
    await refused(tools, 'sub/AI-Settings.json', /settings file/);
    const listed = await tools.call('list_graphs', {});
    expect(listed.text).not.toContain('settings');
    expect(listed.text).not.toContain('MUST-NOT-LEAK');
    expect(await readFile(join(root, 'ai-settings.json'), 'utf8')).toBe(settings);
  });

  it('does not follow a project folder linked out of the root', async () => {
    await writeFile(join(outside, 'code.js'), 'function run() { return { out: "from outside" }; }');
    await mkdir(join(root, 'proj', 'nodes'), { recursive: true });
    await writeFile(join(root, 'proj', 'graph.json'), JSON.stringify(graphOf([code('work', ''), output('result')], [edge('e1', 'work.out', 'result.value')])));
    await symlink(outside, join(root, 'proj', 'nodes', 'work'), process.platform === 'win32' ? 'junction' : 'dir');

    const ran = await toolsWith().call('run_graph', { path: 'proj/graph.json' });
    expect(ran.isError).toBe(true);
    expect(ran.text).toMatch(/outside the folder/);
    expect(ranBody).toBe('');
  });

  it('blanks a configured secret wherever it turns up, a run included', async () => {
    await writeFile(join(root, 'leak.json'), JSON.stringify(hello('the key is hunter2-hunter2-hunter2, apparently')));
    const ran = await toolsWith({ secrets: () => ['hunter2-hunter2-hunter2'] }).call('run_graph', { path: 'leak.json' });
    expect(ran.text).toContain('the key is [redacted], apparently');
    expect(ran.text).not.toContain('hunter2');
  });
});

describe('run_graph', () => {
  it('runs a tiny graph and reports it compactly, every value cut short', async () => {
    const tools = toolsWith();
    await tools.call('save_graph', { path: 'hello.json', graph: hello('x'.repeat(5_000)) });

    const ran = await answer(tools, 'run_graph', { path: 'hello.json' });
    expect(ran.isError).toBeUndefined();
    expect(ran.json.status).toBe('success');
    expect(ran.json.nodes.map((node: { id: string; status: string }) => [node.id, node.status]))
      .toEqual([['greeting', 'success'], ['result', 'success']]);

    const value: string = ran.json.nodes[0].outputs.output;
    expect(value.startsWith('x'.repeat(600))).toBe(true);
    expect(value).toMatch(/… \(\+4400 characters\)$/);
    expect(ran.json.outputs.Result.value).toMatch(/\(\+4400 characters\)$/);
    // Five thousand characters went in at three places; the report is not made of them.
    expect(ran.text.length).toBeLessThan(3_000);
    // What the node was handed is upstream's output again, and is left out.
    expect(ran.json.nodes[1].inputs).toBeUndefined();
  });

  it('applies inputs by node id, and says which keys named nothing', async () => {
    const tools = toolsWith();
    await tools.call('save_graph', { path: 'hello.json', graph: hello('the default') });
    const ran = await answer(tools, 'run_graph', { path: 'hello.json', inputs: { greeting: 'typed instead', nobody: 'x' } });
    expect(ran.json.outputs.Result.value).toBe('typed instead');
    expect(ran.json.ignored_inputs).toEqual(['nobody']);
    // The file is a graph, not a scratchpad: a run's answers are not written back.
    expect(JSON.parse(await readFile(join(root, 'hello.json'), 'utf8')).nodes[0].config.value).toBe('the default');
  });

  it('reports a failing node as a result, with its error, not as a crash', async () => {
    const failing: Runtime = { ...fakeRuntime(), code: { async run() { throw new Error('ReferenceError: nope is not defined'); } } };
    const tools = toolsWith({ runtime: () => failing });
    await tools.call('save_graph', {
      path: 'g.json',
      graph: graphOf([textInput('greeting'), code('work'), output('result')],
        [edge('e1', 'greeting.output', 'work.in'), edge('e2', 'work.out', 'result.value')]),
    });
    const ran = await answer(tools, 'run_graph', { path: 'g.json' });
    expect(ran.isError).toBeUndefined();
    expect(ran.json.status).toBe('partial');
    expect(ran.json.nodes[1]).toMatchObject({ id: 'work', status: 'error', error: 'ReferenceError: nope is not defined' });
    expect(ran.json.nodes[2]).toMatchObject({ id: 'result', status: 'skipped' });
  });

  it('reads the code a project keeps in its files, the way the editor saves one', async () => {
    await mkdir(join(root, 'proj', 'nodes', 'work'), { recursive: true });
    await writeFile(join(root, 'proj', 'graph.json'), JSON.stringify(graphOf(
      [textInput('greeting'), code('work', ''), output('result')],
      [edge('e1', 'greeting.output', 'work.in'), edge('e2', 'work.out', 'result.value')],
    )));
    await writeFile(join(root, 'proj', 'nodes', 'work', 'code.js'), 'function run(inputs) { return { out: "from the file" }; }\n');

    const tools = toolsWith();
    expect((await answer(tools, 'validate_graph', { path: 'proj/graph.json' })).json.valid).toBe(true);
    const ran = await answer(tools, 'run_graph', { path: 'proj/graph.json' });
    expect(ran.json.status).toBe('success');
    expect(ranBody).toContain('from the file');
  });

  it('refuses a trigger that names no node, and a graph that is not there', async () => {
    const tools = toolsWith();
    await tools.call('save_graph', { path: 'hello.json', graph: hello() });
    const wrong = await tools.call('run_graph', { path: 'hello.json', trigger: { node_id: 'ghost' } });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toMatch(/"greeting", "result"/);

    const missing = await tools.call('run_graph', { path: 'nothing.json' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/There is no graph at "nothing.json"/);
  });
});

describe('list_graphs', () => {
  it('lists graphs, and only graphs, and only where graphs live', async () => {
    const put = async (path: string, content: unknown): Promise<void> => {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));
    };
    await put('b.json', hello());
    await put('a/deep/er/graph.json', graphOf([output('only')], [], 'Deep'));
    await put('a/b/c/d/too_deep.json', hello());
    await put('package.json', { name: 'not-a-graph' });
    await put('broken.json', '{ not json');
    await put('node_modules/pkg/graph.json', hello());
    await put('dist/graph.json', hello());
    await put('.hidden/graph.json', hello());
    await put('notes.txt', 'hello');

    const listed = await answer(toolsWith(), 'list_graphs');
    expect(listed.json.graphs.map((graph: { path: string }) => graph.path)).toEqual(['a/deep/er/graph.json', 'b.json']);
    expect(listed.json.graphs[0]).toEqual({ path: 'a/deep/er/graph.json', name: 'Deep', description: 'Deep, described', nodes: 1 });
    expect(listed.json.truncated).toBeUndefined();
  });
});

describe('call', () => {
  it('never throws: an unknown tool and nonsense arguments are both answers', async () => {
    const tools = toolsWith();
    const unknown = await tools.call('format_disk', {});
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/authoring_guide, generate_graph, validate_graph, save_graph, run_graph, list_graphs/);

    for (const args of [null, 'text', [1, 2], { path: 42 }, { path: { toString: null } }]) {
      const result = await tools.call('run_graph', args as never);
      expect(result.isError).toBe(true);
    }
    expect(tools.specs.map((spec) => spec.name)).toEqual(
      ['authoring_guide', 'generate_graph', 'validate_graph', 'save_graph', 'run_graph', 'list_graphs']);
  });
});

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

describe('serveStdio', () => {
  /** Feed lines in, close the input, and hand back every line that came out. */
  const exchange = async (tools: GraphTools, lines: string[]): Promise<{ answers: any[]; logged: string }> => {
    const input = new PassThrough();
    const out = new PassThrough();
    const log = new PassThrough();
    let written = '';
    let logged = '';
    out.on('data', (chunk) => { written += String(chunk); });
    log.on('data', (chunk) => { logged += String(chunk); });

    const served = serveStdio(tools, { input, output: out, log });
    for (const line of lines) input.write(`${line}\n`);
    input.end();
    await served;
    return { answers: written.split('\n').filter(Boolean).map((line) => JSON.parse(line)), logged };
  };

  const rpc = (id: number | undefined, method: string, params?: unknown): string =>
    JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, ...(params === undefined ? {} : { params }) });

  it('shakes hands, lists six tools, answers a ping, and says nothing to a notification', async () => {
    const { answers } = await exchange(toolsWith(), [
      rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }),
      rpc(undefined, 'notifications/initialized'),
      rpc(2, 'ping'),
      rpc(3, 'tools/list', {}),
    ]);
    expect(answers).toHaveLength(3);
    const byId = new Map(answers.map((answer) => [answer.id, answer]));
    expect(byId.get(1).result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ai-graph' } });
    expect(byId.get(2).result).toEqual({});
    expect(byId.get(3).result.tools).toHaveLength(6);
    expect(byId.get(3).result.tools[1]).toMatchObject({ name: 'generate_graph', inputSchema: { type: 'object', required: ['description'] } });
  });

  it('offers its own version to a client that asks for one it does not know', async () => {
    const { answers } = await exchange(toolsWith(), [rpc(1, 'initialize', { protocolVersion: '1999-01-01' })]);
    expect(answers[0].result.protocolVersion).toBe('2025-06-18');
  });

  it('survives everything a client can get wrong, and answers the next line', async () => {
    const { answers } = await exchange(toolsWith(), [
      'this is not json',
      '[1, 2, 3]',
      '42',
      rpc(7, 'resources/list'),
      rpc(8, 'tools/call', { name: 'format_disk', arguments: {} }),
      rpc(9, 'tools/call', { name: 'run_graph', arguments: { path: '../../etc/passwd.json' } }),
      rpc(10, 'tools/call', { name: 'validate_graph' }),
      JSON.stringify({ jsonrpc: '2.0', id: 11 }),
      JSON.stringify({ jsonrpc: '2.0', id: 99, result: {} }),
      rpc(12, 'ping'),
    ]);
    const errors = answers.filter((answer) => answer.id === null).map((answer) => answer.error.code);
    expect(errors).toEqual([-32700, -32600, -32600]);

    const byId = new Map(answers.map((answer) => [answer.id, answer]));
    expect(byId.get(7).error.code).toBe(-32601);
    expect(byId.get(8).error.code).toBe(-32602);
    // A tool that refuses is a result the model gets to read, not a protocol error.
    expect(byId.get(9).error).toBeUndefined();
    expect(byId.get(9).result.isError).toBe(true);
    expect(byId.get(9).result.content[0].text).toMatch(/outside the folder/);
    expect(byId.get(10).result.isError).toBe(true);
    expect(byId.get(11).error.code).toBe(-32600);
    // A response to nothing we asked is not answered.
    expect(byId.has(99)).toBe(false);
    // And after all of that, it is still here.
    expect(byId.get(12).result).toEqual({});
  });

  it('turns a tool that throws into an error result rather than dying', async () => {
    const throwing: GraphTools = {
      specs: [{ name: 'boom', description: '', parameters: { type: 'object', properties: {} } }],
      async call() { throw new Error('the promise not to throw, broken'); },
    };
    const { answers } = await exchange(throwing, [rpc(1, 'tools/call', { name: 'boom', arguments: {} }), rpc(2, 'ping')]);
    const byId = new Map(answers.map((answer) => [answer.id, answer]));
    expect(byId.get(1).result).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringMatching(/broken/) }] });
    expect(byId.get(2).result).toEqual({});
  });

  it('answers a ping while a slow tool is still working', async () => {
    let release: () => void = () => {};
    const slow: GraphTools = {
      specs: [{ name: 'slow', description: '', parameters: { type: 'object', properties: {} } }],
      call: () => new Promise((done) => { release = () => done({ text: 'finally' }); }),
    };
    const input = new PassThrough();
    const out = new PassThrough();
    const seen: any[] = [];
    out.on('data', (chunk) => { for (const line of String(chunk).split('\n').filter(Boolean)) seen.push(JSON.parse(line)); });

    const served = serveStdio(slow, { input, output: out });
    input.write(`${rpc(1, 'tools/call', { name: 'slow', arguments: {} })}\n${rpc(2, 'ping')}\n`);
    await vi.waitFor(() => expect(seen.map((answer) => answer.id)).toEqual([2]));
    // Hanging up does not abandon what was already asked for.
    input.end();
    release();
    await served;
    expect(seen.map((answer) => answer.id)).toEqual([2, 1]);
    expect(seen[1].result.content[0].text).toBe('finally');
  });

  it('drops a line too long to be a graph, says so once, and reads on', async () => {
    const input = new PassThrough();
    const out = new PassThrough();
    let written = '';
    out.on('data', (chunk) => { written += String(chunk); });
    const served = serveStdio(toolsWith(), { input, output: out });

    const chunk = 'x'.repeat(1024 * 1024);
    for (let sent = 0; sent < 6; sent += 1) input.write(chunk);
    input.write(`\n${rpc(1, 'ping')}\n`);
    input.end();
    await served;

    const answers = written.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(answers.map((answer) => answer.id)).toEqual([null, 1]);
    expect(answers[0].error).toMatchObject({ code: -32700, message: expect.stringMatching(/too large/) });
  });
});

// ---------------------------------------------------------------------------
// The whole thing, as a client meets it
// ---------------------------------------------------------------------------

describe('node main.ts --mcp', () => {
  // No settings file of this machine's, whatever is lying around: the tests
  // below call no model, and should not depend on whether one is configured.
  const env = { AI_GRAPH_SETTINGS: join(tmpdir(), 'ai-graph-mcp-no-such-settings.json') };

  it("serves the repo's own MCP client, end to end", async () => {
    const service = mcpToolService(
      { 'ai-graph': { command: process.execPath, args: [MAIN, '--mcp', '--mcp-root', root], env } },
      { handshakeTimeoutMs: 30_000, callTimeoutMs: 30_000 },
    );
    const session = await service.open(['ai-graph']);
    try {
      expect(session.specs.map((spec) => spec.name)).toEqual(
        ['authoring_guide', 'generate_graph', 'validate_graph', 'save_graph', 'run_graph', 'list_graphs']);

      expect(await session.call('authoring_guide', {})).toContain('Graph DSL');

      expect(JSON.parse(await session.call('validate_graph', { graph: hello() }))).toEqual({ valid: true, problems: [] });
      const broken = JSON.parse(await session.call('validate_graph', { graph: graphOf([code('alone', '')]) }));
      expect(broken.valid).toBe(false);
      expect(broken.problems).toHaveLength(2);

      // Saved through the protocol, run through the protocol, in the folder it was given.
      expect(JSON.parse(await session.call('save_graph', { path: 'hello.json', graph: hello('over the wire') })).saved).toBe('hello.json');
      expect(existsSync(join(root, 'hello.json'))).toBe(true);
      const ran = JSON.parse(await session.call('run_graph', { path: 'hello.json' }));
      expect(ran.status).toBe('success');
      expect(ran.outputs.Result.value).toBe('over the wire');

      expect(await session.call('run_graph', { path: '../hello.json' })).toMatch(/^Tool error: .*outside the folder/);
    } finally {
      await session.close();
    }
  }, 60_000);

  it('puts protocol on stdout and nothing else, and leaves when stdin closes', async () => {
    const child = spawn(process.execPath, [MAIN, '--mcp', '--mcp-root', root], {
      env: { ...process.env, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += String(chunk); });
    child.stderr.on('data', (chunk) => { err += String(chunk); });

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
    child.stdin.write('garbage\n');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_graphs', arguments: {} } })}\n`);
    child.stdin.end();
    const exit = await new Promise<number | null>((done) => child.on('close', done));

    expect(exit).toBe(0);
    const lines = out.split('\n').filter(Boolean);
    // Every line parses, or a client somewhere is looking at a parse error.
    const answers = lines.map((line) => JSON.parse(line));
    expect(answers.map((answer) => answer.id).sort()).toEqual([1, 2, null].sort());
    // The banner is for a person, and went where a person looks.
    expect(err).toMatch(/confined to/);
  }, 60_000);

  it('says why, on stderr, when the root is not a folder', async () => {
    const child = spawn(process.execPath, [MAIN, '--mcp', '--mcp-root', join(root, 'nowhere')], {
      env: { ...process.env, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += String(chunk); });
    child.stderr.on('data', (chunk) => { err += String(chunk); });
    const exit = await new Promise<number | null>((done) => child.on('close', done));
    expect(exit).toBe(1);
    expect(out).toBe('');
    expect(err).toMatch(/is not a folder/);
  }, 60_000);
});
