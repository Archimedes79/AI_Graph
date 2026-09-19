import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGraph, type Graph } from '../graph.ts';
import { checkPath, problemsIn } from './check.ts';
import { forgetSeen, writeProject } from './folder.ts';

const port = (id: string, kind: 'input' | 'output') => ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '' });

function graph(overrides: { schema?: unknown; template?: string } = {}): Graph {
  return parseGraph({
    metadata: { name: 'Checked' },
    nodes: [
      {
        id: 'count', node_type: 'code', label: 'Count', inputs: [], outputs: [port('total', 'output')],
        config: { code: 'function run() { return { total: 1 }; }', ...(overrides.schema !== undefined ? { output_schema: overrides.schema } : {}) },
      },
      {
        id: 'say', node_type: 'ai', label: 'Say', inputs: [port('total', 'input')], outputs: [port('output', 'output')],
        config: { system_prompt: 'Report.', prompt_template: overrides.template ?? 'There are {{total}}.' },
      },
      { id: 'show', node_type: 'output', label: 'Show', inputs: [port('value', 'input')], outputs: [], config: { write_mode: 'window' } },
    ],
    edges: [
      { id: 'e1', source_node_id: 'count', source_port_id: 'total', target_node_id: 'say', target_port_id: 'total' },
      { id: 'e2', source_node_id: 'say', source_port_id: 'output', target_node_id: 'show', target_port_id: 'value' },
    ],
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-graph-check-'));
  forgetSeen();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('what check finds in a graph', () => {
  it('finds nothing in a sound one', () => {
    expect(problemsIn(graph({ schema: { type: 'object', properties: { total: { type: 'integer' } } } }))).toEqual([]);
  });

  it('finds an output interface that names a port the node does not have', () => {
    const problems = problemsIn(graph({ schema: { type: 'object', properties: { sum: { type: 'integer' } } } }));
    expect(problems).toEqual([expect.objectContaining({
      where: 'node "count"', problem: expect.stringMatching(/describes "sum", which is not one of its outputs/),
    })]);
  });

  it('finds an output interface that is not a schema at all', () => {
    expect(problemsIn(graph({ schema: 'not json' }))[0].problem).toMatch(/not a JSON Schema object/);
  });

  it('finds a message placeholder no input fills', () => {
    const problems = problemsIn(graph({ template: 'There are {{totl}} of {{input}}.' }));
    expect(problems).toEqual([expect.objectContaining({ problem: 'Its message template asks for {{totl}}, and it has no input "totl".' })]);
  });
});

describe('what check finds in a project folder', () => {
  it('finds a folder no node owns, and a file nothing reads', async () => {
    await writeProject(dir, graph());
    await mkdir(join(dir, 'nodes', 'old_step'));
    await writeFile(join(dir, 'nodes', 'old_step', 'code.js'), '');
    await writeFile(join(dir, 'nodes', 'say', 'prompt.md'), 'Written, never sent.');

    const { problems } = await checkPath(dir);
    expect(problems.map((p) => [p.where, p.problem])).toEqual([
      ['nodes/old_step', 'This folder belongs to no node in graph.json.'],
      ['nodes/say/prompt.md', 'Nothing reads this file.'],
    ]);
    expect(problems[1].fix).toMatch(/"system.md"/);
  });

  it('is content with a folder for a node that keeps no writing yet', async () => {
    await writeProject(dir, graph());
    await mkdir(join(dir, 'nodes', 'show'));
    expect((await checkPath(dir)).problems).toEqual([]);
  });

  it('reports a project that cannot be read, rather than failing', async () => {
    await writeFile(join(dir, 'graph.json'), '{ broken');
    const { problems, graph: read } = await checkPath(dir);
    expect(read).toBeNull();
    expect(problems[0].problem).toMatch(/not valid JSON/);
  });
});

describe('what check finds in a node\'s examples', () => {
  const fence = '```';
  const example = (title: string, input: unknown, expect: unknown) =>
    `## ${title}\n${fence}json input\n${JSON.stringify(input)}\n${fence}\n${fence}json expect\n${JSON.stringify(expect)}\n${fence}\n`;
  /** count produces "total"; say consumes it, and its examples say what it expects to be given. */
  const withExamples = (examples: string, schema: unknown = { type: 'object', properties: { total: { type: 'integer' } } }) => {
    const g = graph({ schema });
    g.nodes[1].node_type = 'code';
    g.nodes[1].config = { code: 'function run(i) { return { output: i.total }; }', examples };
    return g;
  };

  it('is content with examples that fit the node and its neighbours', () => {
    expect(problemsIn(withExamples(example('Seven', { total: 7 }, { output: 7 })))).toEqual([]);
  });

  it('finds ports an example names that the node does not have', () => {
    const problems = problemsIn(withExamples(example('Typo', { totl: 7 }, { outptu: 7 })));
    expect(problems.map((p) => p.problem)).toEqual([
      'It gives an input "totl", which the node does not have.',
      'It expects an output "outptu", which the node does not have.',
    ]);
  });

  it('finds an example asking for what the node wired into that port does not give', () => {
    const [problem] = problemsIn(withExamples(example('As text', { total: 'seven' }, { output: 'seven' })));
    expect(problem.where).toBe('node "say", example "As text"');
    expect(problem.problem).toBe('"count" is wired into "total", and what this example gives there does not fit its output interface: input "total" is string; the interface says integer.');
    expect(problem.fix).toMatch(/Either this example asks for the wrong thing, or "count" has to deliver it/);
  });

  it('reports examples.md it cannot read', () => {
    expect(problemsIn(withExamples('## Half\n```json input\n{\n```\n'))[0].where).toBe('node "say", examples.md');
  });
});

/**
 * A graph inside a node is checked by the same function that checks the one
 * above it, so everything it can get wrong is already covered. What is here is
 * the boundary between the two, and the few things that only make sense in
 * there.
 */
describe('a graph inside a node', () => {
  const holder = (inner: unknown, config: Record<string, unknown> = {}) => parseGraph({
    metadata: { name: 'Outer' },
    nodes: [
      { id: 'part', node_type: 'subgraph', label: 'Part', inputs: [], outputs: [], config: { subgraph: inner, ...config } },
      { id: 'show', node_type: 'output', label: 'Show', inputs: [port('value', 'input')], outputs: [], config: {} },
    ],
    edges: [],
  });

  const inner = (nodes: unknown[], edges: unknown[] = []) => ({ metadata: { name: 'Inner' }, nodes, edges });

  const said = (problems: { where: string; problem: string }[]) => problems.map((p) => `${p.where}: ${p.problem}`);

  it('reports what is wrong in there, saying which node it is in', () => {
    const problems = problemsIn(holder(inner([
      { id: 'broken', node_type: 'code', label: 'Broken', inputs: [], outputs: [port('out', 'output')], config: { code: '' } },
      { id: 'out', node_type: 'output', label: 'Out', inputs: [port('value', 'input')], outputs: [], config: {} },
    ])));
    expect(said(problems)).toContainEqual(expect.stringContaining('node "part" ▸ node "broken": A code node with no config.code'));
  });

  it('wants something to come out of it, in its own words', () => {
    const problems = problemsIn(holder(inner([
      { id: 'lonely', node_type: 'code', label: 'Lonely', inputs: [], outputs: [], config: { code: 'function run() { return {}; }' } },
    ])));
    expect(said(problems)).toContainEqual(expect.stringContaining('node "part" ▸ graph: Nothing comes out'));
  });

  it('refuses two ports of one name, and an output node carrying more than one value', () => {
    const problems = problemsIn(holder(inner([
      { id: 'a', node_type: 'input', label: 'Text', inputs: [], outputs: [], config: { input_mode: 'text' } },
      { id: 'b', node_type: 'input', label: 'Text', inputs: [], outputs: [], config: { input_mode: 'text' } },
      { id: 'two', node_type: 'output', label: 'Two', inputs: [port('one', 'input'), port('other', 'input')], outputs: [], config: {} },
    ])));
    expect(said(problems)).toContainEqual(expect.stringContaining('that is two ports of the same name'));
    expect(said(problems)).toContainEqual(expect.stringContaining('has 2 inputs'));
  });

  it('says a page in there would never be shown, and a question in there never asked', () => {
    const problems = problemsIn(holder(inner([
      { id: 'page', node_type: 'gui', label: 'Page', inputs: [], outputs: [], config: { gui_widgets: [] } },
      { id: 'asks', node_type: 'input', label: 'Asks', inputs: [], outputs: [], config: { input_mode: 'file', prompt_at_runtime: true } },
      { id: 'out', node_type: 'output', label: 'Out', inputs: [port('value', 'input')], outputs: [], config: {} },
    ])));
    expect(said(problems)).toContainEqual(expect.stringContaining('a page in here would never be shown'));
    expect(said(problems)).toContainEqual(expect.stringContaining('only the graph at the top is asked'));
  });

  it('calls a described but empty part out, because that is a plan and not a graph', () => {
    const problems = problemsIn(holder(inner([]), { task: 'Summarise the paper.' }));
    expect(said(problems)).toContainEqual(expect.stringContaining('described and empty'));
  });

  it('says so when what it holds is not a graph at all', () => {
    const problems = problemsIn(holder('not a graph'));
    expect(said(problems)).toContainEqual(expect.stringContaining('cannot be read'));
  });

  it('is quiet about a part that is right', async () => {
    const good = holder(inner([
      { id: 'text', node_type: 'input', label: 'Text', inputs: [], outputs: [], config: { input_mode: 'text', value: 'hi' } },
      { id: 'out', node_type: 'output', label: 'Short', inputs: [port('value', 'input')], outputs: [], config: {} },
    ], [{ id: 'i1', source_node_id: 'text', source_port_id: 'output', target_node_id: 'out', target_port_id: 'value' }]));
    expect(problemsIn(good)).toEqual([]);

    // And on disk, where its folder is a project folder of its own.
    await writeProject(dir, good);
    const { problems } = await checkPath(dir);
    expect(problems).toEqual([]);
  });
});
