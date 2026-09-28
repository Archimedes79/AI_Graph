import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGraph, type Graph } from '../graph.ts';
import { NotAGraph } from '../errors.ts';
import { problemsIn } from './check.ts';
import { RUN_ON_ITS_OWN } from '../elements/nodes/code/CodeNodeRunner.ts';
import { DEFINITION_TEXTS, definitionExample } from '../authoring/definition.ts';
import { DataNodeRunner } from '../elements/nodes/data/DataNodeRunner.ts';
import {
  FileChanged, changesOnDisk, forgetSeen, isProjectFolder, loadGraph, nodeFileOf, projectFolderOf, readProject, saveGraph, writeProject,
} from './folder.ts';

const port = (id: string, kind: 'input' | 'output') => ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '' });

/** A code node and an ai node, which keep writing, beside a directory input and a page with a chart, which keep none. */
function sample(): Graph {
  return parseGraph({
    metadata: { name: 'Sample', description: 'All the writing there is.' },
    nodes: [
      {
        id: 'folder', node_type: 'input', label: 'Folder', position: { x: 10, y: 20 },
        inputs: [], outputs: [port('files', 'output')],
        config: { input_mode: 'directory', value: 'data', extensions: '.csv' },
      },
      {
        id: 'count', node_type: 'code', label: 'Count', position: { x: 300.4, y: 20 }, width: 360, height: 180,
        inputs: [port('files', 'input')], outputs: [port('total', 'output')],
        config: {
          code: 'function run(inputs) {\n  return { total: inputs.files.length };\n}',
          input_definition: 'module.exports = { "files": ["a.csv"] };',
          output_definition: 'module.exports = { "total": 1 };',
          history: '## 2026-09-28 09:05 · ✨ Code\n\nNothing was sent.',
          batch_mode: 'whole_list',
        },
      },
      {
        id: 'say', node_type: 'ai', label: 'Say it', position: { x: 600, y: 20 },
        inputs: [port('total', 'input')], outputs: [port('output', 'output')],
        config: { prompt: 'Say how many files there are, in one sentence.', temperature: 0.2 },
      },
      {
        id: 'page', node_type: 'gui', label: 'Page', position: { x: 900, y: 20 },
        inputs: [port('chart_in', 'input')], outputs: [],
        config: { gui_widgets: [{ id: 'chart', kind: 'plot_window', label: 'Chart' }] },
      },
    ],
    edges: [
      { id: 'e1', source_node_id: 'folder', source_port_id: 'files', target_node_id: 'count', target_port_id: 'files' },
      { id: 'e2', source_node_id: 'count', source_port_id: 'total', target_node_id: 'say', target_port_id: 'total' },
    ],
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-graph-project-'));
  forgetSeen();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const text = (path: string) => readFile(join(dir, path), 'utf8');

/** A distinct modification time, so a change within the same millisecond still shows. */
const touch = async (path: string, content: string) => {
  await writeFile(path, content);
  const later = new Date(Date.now() + 5_000);
  await utimes(path, later, later);
};

describe('a project folder', () => {
  it('keeps each piece of writing in a file named for what it is', async () => {
    await writeProject(dir, sample());
    expect(await text('nodes/count/code.js')).toBe(`function run(inputs) {\n  return { total: inputs.files.length };\n}\n\n${RUN_ON_ITS_OWN}\n`);
    expect(await text('nodes/count/input.js')).toBe('module.exports = { "files": ["a.csv"] };\n');
    expect(await text('nodes/count/output.js')).toBe('module.exports = { "total": 1 };\n');
    expect(await text('nodes/count/history.md')).toBe('## 2026-09-28 09:05 · ✨ Code\n\nNothing was sent.\n');
    expect(await text('nodes/say/prompt.md')).toBe('Say how many files there are, in one sentence.\n');
    // A folder listing and a chart have no writing of their own.
    expect(existsSync(join(dir, 'nodes/folder/select.js'))).toBe(false);
    expect(existsSync(join(dir, 'nodes/page/chart'))).toBe(false);
  });

  it('says the flow once, in flow.json, and nothing about any node there', async () => {
    await writeProject(dir, sample());
    expect(JSON.parse(await text('flow.json'))).toEqual({
      name: 'Sample',
      description: 'All the writing there is.',
      nodes: { folder: 'input', count: 'code', say: 'ai', page: 'gui' },
      wires: ['folder.files -> count.files', 'count.total -> say.total'],
    });
  });

  it('keeps a node\'s settings in its node.json and its ports in its interface.json', async () => {
    await writeProject(dir, sample());
    expect(JSON.parse(await text('nodes/count/node.json'))).toEqual({ label: 'Count', config: { batch_mode: 'whole_list' } });
    expect(JSON.parse(await text('nodes/say/node.json')).config).toEqual({ temperature: 0.2 });
    expect(JSON.parse(await text('nodes/page/node.json')).config.gui_widgets[0]).toEqual({ id: 'chart', kind: 'plot_window', label: 'Chart' });
    const ports = JSON.parse(await text('nodes/count/interface.json'));
    expect(ports.inputs).toEqual([{ port: 'files', type: 'any' }]);
    expect(ports.outputs).toEqual([{ port: 'total', type: 'any' }]);
    // Nothing about who is on the other end of a wire: that is the flow's.
    expect(JSON.stringify(ports)).not.toContain('folder');
    expect(JSON.parse(await text('layout.json')).count).toEqual({ x: 300, y: 20, width: 360, height: 180 });
  });

  it('reads back exactly what was written', async () => {
    const original = sample();
    await writeProject(dir, original);
    const read = await readProject(dir);
    original.nodes[1].position.x = 300; // stored rounded
    const sortedKeys = (value: unknown): unknown => (Array.isArray(value) ? value.map(sortedKeys)
      : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])])) : value);
    expect(sortedKeys(read.nodes)).toEqual(sortedKeys(original.nodes.map((node) => ({ ...node, width: node.width ?? null, height: node.height ?? null }))));
    // A wire is named by what it joins.
    expect(read.edges).toEqual(original.edges.map((edge) => ({
      ...edge, id: `${edge.source_node_id}.${edge.source_port_id} -> ${edge.target_node_id}.${edge.target_port_id}`,
    })));
    expect(read.metadata.name).toBe('Sample');
  });

  it('keeps the settings an older file carries that nothing reads, as it wrote them', async () => {
    // version, author and tags are no setting of the graph's any more; a file
    // that has them keeps them through an open and a save, whatever they say.
    const graph = sample();
    Object.assign(graph.metadata, { version: '1.0.0', author: 'Ada', tags: [] });
    await writeProject(dir, graph);
    const read = await readProject(dir);
    expect(read.metadata).toMatchObject({ version: '1.0.0', author: 'Ada', tags: [] });
    expect(JSON.parse(await text('flow.json'))).toMatchObject({ version: '1.0.0', author: 'Ada', tags: [] });
  });

  it('writes the same bytes for the same graph, so an unchanged save is no change', async () => {
    await writeProject(dir, sample());
    const files = ['flow.json', 'layout.json', 'nodes/count/node.json', 'nodes/count/interface.json', 'nodes/page/node.json'];
    const first = await Promise.all(files.map(text));
    await writeProject(dir, await readProject(dir));
    expect(await Promise.all(files.map(text))).toEqual(first);
  });

  it('writes every file a node has from the start: a stub for what it holds nothing of, which reads back as nothing', async () => {
    const graph = sample();
    graph.nodes[1].config.output_definition = '';
    graph.nodes[2].config.prompt = '';
    await writeProject(dir, graph);
    const [inputStub, outputStub] = DEFINITION_TEXTS.map((text) => `${text.standard}\n`);
    expect(await text('nodes/count/output.js')).toBe(outputStub);
    expect(await text('nodes/say/input.js')).toBe(inputStub);
    expect(await text('nodes/say/output.js')).toBe(outputStub);
    expect(await text('nodes/say/prompt.md')).toMatch(/^<!--\nprompt\.md: the instructions/);
    // History comes with the first exchange, not before.
    expect(existsSync(join(dir, 'nodes/say/history.md'))).toBe(false);
    forgetSeen();
    const read = await readProject(dir);
    expect(read.nodes[1].config).not.toHaveProperty('output_definition');
    expect(read.nodes[2].config).not.toHaveProperty('prompt');
    expect(read.nodes[2].config).not.toHaveProperty('input_definition');
    // A stub is not a problem check names: it is a node that says nothing there yet.
    expect(problemsIn(read)).toEqual([]);
  });

  it('takes the part that runs code.js on its own out wherever it stands: code added after it is the node\'s', async () => {
    const graph = sample();
    Object.assign(graph.nodes[1].config, { code: 'function run() { return { total: 1 }; }' });
    await writeProject(dir, graph);
    const path = join(dir, 'nodes', 'count', 'code.js');
    await writeFile(path, `${await readFile(path, 'utf8')}\nfunction helper() { return 2; }\n`);
    forgetSeen();
    const read = await readProject(dir);
    expect(read.nodes[1].config.code).toBe('function run() { return { total: 1 }; }\n\nfunction helper() { return 2; }');
    await writeProject(dir, read);
    expect((await readFile(path, 'utf8')).split(RUN_ON_ITS_OWN)).toHaveLength(2);
  });

  it('writes code.js so it runs on its own on its example, and reads back the code without that part', async () => {
    const graph = sample();
    Object.assign(graph.nodes[1].config, {
      code: 'function run(inputs) {\n  return { total: inputs.files.length };\n}',
      input_definition: 'module.exports = { "files": ["a.csv", "b.csv"] };',
    });
    await writeProject(dir, graph);
    const { stdout } = await promisify(execFile)(process.execPath, [join(dir, 'nodes', 'count', 'code.js')], { cwd: dir });
    expect(JSON.parse(stdout)).toEqual({ total: 2 });
    forgetSeen();
    expect((await readProject(dir)).nodes[1].config.code).toBe('function run(inputs) {\n  return { total: inputs.files.length };\n}');
    // Edited in another editor with its own line ends, it is still taken off.
    await touch(join(dir, 'nodes/count/code.js'), (await text('nodes/count/code.js')).replace(/\n/g, '\r\n'));
    expect(await changesOnDisk(dir)).toEqual([{ node_id: 'count', field: 'code', value: 'function run(inputs) {\n  return { total: inputs.files.length };\n}' }]);
  }, 30_000);

  it('writes code.js so it runs on its own as an ES module too: a body that imports, a folder whose package.json says "type": "module"', async () => {
    const graph = sample();
    Object.assign(graph.nodes[1].config, {
      code: "import { basename } from 'node:path';\n\nfunction run(inputs) {\n  return { total: inputs.files.map((file) => basename(file)).join(' ') };\n}",
      input_definition: 'module.exports = { "files": ["data/a.csv", "data/b.csv"] };',
    });
    await writeProject(dir, graph);
    const run = async () => JSON.parse((await promisify(execFile)(process.execPath, [join(dir, 'nodes', 'count', 'code.js')], { cwd: dir })).stdout);
    expect(await run()).toEqual({ total: 'a.csv b.csv' });
    // Every .js file under it is an ES module now, input.js among them: it is read as text all the same.
    await writeFile(join(dir, 'package.json'), '{ "type": "module" }\n');
    Object.assign(graph.nodes[1].config, { code: 'function run(inputs) {\n  return { total: inputs.files.length };\n}' });
    await writeProject(dir, graph);
    expect(await run()).toEqual({ total: 2 });
  }, 30_000);

  it('runs code.js on its own on the example ▶ Try runs on: input.js read by the same rule, or refused with its reason', async () => {
    const graph = sample();
    Object.assign(graph.nodes[1].config, { code: 'function run(inputs) {\n  return inputs;\n}' });
    await writeProject(dir, graph);
    const inputs = join(dir, 'nodes', 'count', 'input.js');
    const run = async (definition: string) => {
      await writeFile(inputs, definition);
      try {
        return { example: JSON.parse((await promisify(execFile)(process.execPath, [join(dir, 'nodes', 'count', 'code.js')], { cwd: dir })).stdout) };
      } catch (error) {
        return { failed: String((error as { stderr?: string }).stderr) };
      }
    };
    for (const definition of [
      '/**\n * @typedef {Object} Input\n * @property {string[]} files  the files (module.exports = their names)\n */\nmodule.exports = { "files": ["a;b.csv"] }',
      'const note = "module.exports = 1";\nmodule.exports = { "files": [{ "name": "}" }] }; // one; or two',
      "module.exports = { files: ['a.csv'] };",
      'module.exports = ["a.csv"];',
      '/** @typedef {Object} Input */',
    ]) {
      const read = definitionExample(definition);
      const ran = await run(definition);
      if ('example' in read) expect(ran).toEqual({ example: read.example });
      else expect(ran.failed).toContain(`input.js cannot be read: ${read.problem.split(' (')[0]}`);
    }
    expect((await run('module.exports = null;')).failed).toContain('input.js has no example yet: write it with ✨ Input.');
  }, 60_000);

  it('keeps what a data node holds as JSON where it holds structure, as text otherwise', async () => {
    const data = (id: string, config: Record<string, unknown>) => ({
      id, node_type: 'data', label: id, inputs: [port('input', 'input')], outputs: [port('output', 'output')], config,
    });
    const graph = parseGraph({
      metadata: { name: 'Held' },
      nodes: [
        data('count', { data_format: 'structure', data_value: { count: 2, names: ['Ada'] } }),
        data('note', { data_format: 'text', data_value: 'Line one.\nLine two.' }),
        // A run left a record in a node kept as text: it is written as its JSON, and reads back as that text.
        data('left', { data_format: 'text', data_value: { count: 3 } }),
      ],
      edges: [],
    });
    await writeProject(dir, graph);
    expect(JSON.parse(await text('nodes/count/data.json'))).toEqual({ count: 2, names: ['Ada'] });
    expect(await text('nodes/note/data.txt')).toBe('Line one.\nLine two.\n');
    expect(JSON.parse(await text('nodes/count/node.json')).config).toEqual({ data_format: 'structure' });
    forgetSeen();
    const read = await readProject(dir);
    expect(read.nodes.map((node) => node.config.data_value)).toEqual([{ count: 2, names: ['Ada'] }, 'Line one.\nLine two.', '{\n  "count": 3\n}']);
  });

  it('reads a count a run left in a text node back as a count: the node holds structure from then on', async () => {
    // A counter: a data node, kept as text as a new one is, and a code node adding one.
    const graph = parseGraph({
      metadata: { name: 'Count' },
      nodes: [{ id: 'counter', node_type: 'data', label: 'Counter', inputs: [port('input', 'input')], outputs: [port('output', 'output')], config: { data_format: 'text', data_value: '' } }],
      edges: [],
    });
    new DataNodeRunner().settleMemory(graph.nodes[0], 'input', 1);
    await writeProject(dir, graph);
    forgetSeen();
    const read = await readProject(dir);
    expect(read.nodes[0].config.data_value).toBe(1);
    expect(read.nodes[0].config.data_format).toBe('structure');
  });

  it('removes a deleted node\'s files, and nothing a person put there', async () => {
    const graph = sample();
    await writeProject(dir, graph);
    await writeFile(join(dir, 'nodes/say/notes.txt'), 'mine');
    graph.nodes = graph.nodes.filter((node) => node.id !== 'say' && node.id !== 'count');
    graph.edges = [];
    await writeProject(dir, graph);
    expect(existsSync(join(dir, 'nodes/count'))).toBe(false);
    expect(existsSync(join(dir, 'nodes/say/prompt.md'))).toBe(false);
    expect(await text('nodes/say/notes.txt')).toBe('mine');
  });

  it('keeps a person\'s file in a node\'s folder, whatever it is called and however deep', async () => {
    const graph = sample();
    await writeProject(dir, graph);
    await mkdir(join(dir, 'nodes/count/fixtures'), { recursive: true });
    await writeFile(join(dir, 'nodes/count/fixtures/code.js'), '// mine, a fixture');
    await writeFile(join(dir, 'nodes/count/fixtures/node.json'), '{}');
    await writeProject(dir, await readProject(dir));
    expect(await text('nodes/count/fixtures/code.js')).toBe('// mine, a fixture');
    expect(existsSync(join(dir, 'nodes/count/fixtures/node.json'))).toBe(true);
  });

  it('keeps the files of a node whose type is a typo in flow.json', async () => {
    await writeProject(dir, sample());
    const flow = JSON.parse(await text('flow.json'));
    flow.nodes.count = 'cdoe';
    await writeFile(join(dir, 'flow.json'), JSON.stringify(flow));
    forgetSeen();
    await writeProject(dir, await readProject(dir));
    expect(await text('nodes/count/code.js')).toContain('inputs.files.length');
  });

  it('takes a file edited in another editor, with Windows line endings and a final newline', async () => {
    await writeProject(dir, sample());
    await writeFile(join(dir, 'nodes/say/prompt.md'), 'Line one.\r\nLine two.\r\n');
    const read = await readProject(dir);
    expect(read.nodes.find((node) => node.id === 'say')!.config.prompt).toBe('Line one.\nLine two.');
  });

  it('opens a deploy bundle by its graph.json, one file with everything inline, and keeps it one', async () => {
    const graph = sample();
    await writeFile(join(dir, 'graph.json'), JSON.stringify(graph));
    await writeFile(join(dir, 'run.sh'), 'exec node engine/main.ts graph.json --serve "$@"\n');
    expect(isProjectFolder(dir)).toBe(false);
    const read = await loadGraph(join(dir, 'graph.json'));
    expect(read.nodes[1].config.code).toContain('inputs.files.length');
    await saveGraph(join(dir, 'graph.json'), read);
    expect(existsSync(join(dir, 'graph.json'))).toBe(true);
    expect(existsSync(join(dir, 'flow.json'))).toBe(false);
  });
});

describe('a node\'s files, opened in the person\'s own editor', () => {
  it('can be each text the node keeps -- and nothing else of its folder', async () => {
    await writeProject(dir, sample());
    expect(await nodeFileOf(dir, 'count')).toBe('count/code.js');
    expect(await nodeFileOf(dir, 'count', 'output.js')).toBe('count/output.js');
    // A text nobody has written yet is there as its stub, so there is something to open.
    expect(await nodeFileOf(dir, 'say', 'input.js')).toBe('say/input.js');
    expect(await text('nodes/say/input.js')).toMatch(/module\.exports = null;\n$/);
    for (const file of ['node.json', '../say/prompt.md', 'example/rows.csv']) {
      await expect(nodeFileOf(dir, 'count', file), file).rejects.toThrow(/is not one of the files of "count": it keeps input\.js, output\.js, code\.js, history\.md\./);
    }
  });
});

describe('what a folder could write and not read back', () => {
  const code = (id: string, body: string) => ({
    id, node_type: 'code', label: id, position: { x: 0, y: 0 },
    inputs: [port('in', 'input')], outputs: [port('out', 'output')], config: { code: body },
  });
  const wire = (from: string, fromPort: string, to: string, toPort: string) =>
    ({ id: `${from}-${to}`, source_node_id: from, source_port_id: fromPort, target_node_id: to, target_port_id: toPort });

  it('refuses two ids that differ only in case: one disk folder, one body left', async () => {
    const graph = parseGraph({ metadata: { name: 'Case' }, nodes: [code('Count', 'UPPER'), code('count', 'lower')], edges: [] });
    await expect(writeProject(dir, graph)).rejects.toThrow(/share a folder/);
    expect(existsSync(join(dir, 'flow.json'))).toBe(false);
    expect(problemsIn(graph).some((p) => /share a folder/.test(p.problem))).toBe(true);
  });

  it('refuses a node id or port a wire in flow.json could not be read back from', async () => {
    for (const [id, portId] of [['a->b', 'out'], [' a', 'out'], ['', 'out'], ['a', 'o->ut'], ['a', '']]) {
      const graph = parseGraph({ metadata: { name: 'Wire' }, nodes: [code(id, 'x'), code('z', 'y')], edges: [wire(id, portId, 'z', 'in')] });
      await expect(writeProject(dir, graph), JSON.stringify([id, portId])).rejects.toThrow();
      expect(problemsIn(graph).length, JSON.stringify([id, portId])).toBeGreaterThan(0);
    }
    expect(existsSync(join(dir, 'flow.json'))).toBe(false);
  });

  it('refuses a node id that is a number, which would come back in another order', async () => {
    const graph = parseGraph({ metadata: { name: 'Order' }, nodes: [code('b', 'x'), code('2', 'y'), code('1', 'z')], edges: [] });
    await expect(writeProject(dir, graph)).rejects.toThrow(/is a number/);
  });

  it('keeps a page\'s blocks in its node.json, with no folder of their own -- two of one id are check\'s to name', async () => {
    const graph = parseGraph({
      metadata: { name: 'Blocks' },
      nodes: [{
        id: 'page', node_type: 'gui', label: 'Page', position: { x: 0, y: 0 }, inputs: [], outputs: [],
        config: { gui_widgets: [
          { id: 'chart', kind: 'input_picker', mode: 'directory', value: 'first' },
          { id: 'chart', kind: 'input_picker', mode: 'directory', value: 'second' },
        ] },
      }],
      edges: [],
    });
    await writeProject(dir, graph);
    expect(existsSync(join(dir, 'nodes/page/chart'))).toBe(false);
    const blocks = (await readProject(dir)).nodes[0].config.gui_widgets as { value: string }[];
    expect(blocks.map((block) => block.value)).toEqual(['first', 'second']);
    expect(problemsIn(graph)).toEqual([expect.objectContaining({ problem: 'More than one block has the id "chart".' })]);
  });

  it('says a node.json that is not an object is not a graph, rather than failing somewhere else', async () => {
    await writeProject(dir, sample());
    for (const about of ['"x"', '{"label": "Count", "config": "x"}', '{"config": [1, 2]}']) {
      await writeFile(join(dir, 'nodes/count/node.json'), about);
      forgetSeen();
      await expect(readProject(dir), about).rejects.toThrow(NotAGraph);
    }
  });

  it('puts nodes in a row, not on top of each other, when layout.json is missing', async () => {
    await writeProject(dir, sample());
    await rm(join(dir, 'layout.json'));
    forgetSeen();
    const at = (await readProject(dir)).nodes.map((node) => `${node.position.x},${node.position.y}`);
    expect(new Set(at).size).toBe(at.length);
  });

  it('counts a file changed while the project was being read as changed', async () => {
    // The node's settings are read, then changed by someone else before the
    // reading ends: a save must not take the change for what it read.
    await writeProject(dir, sample());
    forgetSeen();
    const graph = await readProject(dir, async (path) => {
      if (path.endsWith('layout.json')) await touch(join(dir, 'nodes/count/node.json'), '{"label": "Changed", "config": {}}\n');
    });
    await expect(writeProject(dir, graph)).rejects.toThrow(FileChanged);
    expect(JSON.parse(await text('nodes/count/node.json')).label).toBe('Changed');
  });
});

describe('finding a project', () => {
  it('is the folder, or its flow.json named directly', async () => {
    await writeProject(dir, sample());
    expect(projectFolderOf(dir)).toBe(dir);
    expect(projectFolderOf(join(dir, 'flow.json'))).toBe(dir);
    expect((await loadGraph(join(dir, 'flow.json'))).nodes).toHaveLength(4);
  });

  it('is not a plain graph file, which saves as one file with everything inline', async () => {
    const path = join(dir, 'plain.json');
    await saveGraph(path, sample());
    expect(projectFolderOf(path)).toBeNull();
    expect(JSON.parse(await readFile(path, 'utf8')).nodes[1].config.code).toContain('inputs.files.length');
    expect(existsSync(join(dir, 'nodes'))).toBe(false);
  });

  it('saves a path without .json as a new project folder', async () => {
    await saveGraph(join(dir, 'fresh'), sample());
    expect(isProjectFolder(join(dir, 'fresh'))).toBe(true);
    expect(existsSync(join(dir, 'fresh', 'nodes', 'count', 'code.js'))).toBe(true);
  });

  it('says why a path is not a graph', async () => {
    await expect(loadGraph(join(dir, 'missing.json'))).rejects.toThrow(/Nothing at/);
    await mkdir(join(dir, 'empty'));
    await expect(loadGraph(join(dir, 'empty'))).rejects.toThrow(/not a project/);
    await writeFile(join(dir, 'package.json'), '{"name": "x"}');
    await expect(loadGraph(join(dir, 'package.json'))).rejects.toThrow(/not a graph/);
  });
});

describe('two editors on one folder', () => {
  it('refuses to overwrite a file changed outside since it was read', async () => {
    const graph = sample();
    await writeProject(dir, graph);
    await touch(join(dir, 'nodes/count/code.js'), 'function run() { return { total: 1 }; }\n');
    graph.nodes[1].config.code = 'function run() { return { total: 2 }; }';
    await expect(writeProject(dir, graph)).rejects.toThrow(FileChanged);
    expect(await text('nodes/count/code.js')).toContain('total: 1');
  });

  it('writes again what was deleted outside: nothing there, nothing to lose', async () => {
    const graph = sample();
    await writeProject(dir, graph);
    await rm(join(dir, 'nodes'), { recursive: true });
    await expect(writeProject(dir, graph)).resolves.toBeUndefined();
    expect(await text('nodes/count/code.js')).toContain('inputs.files.length');
  });

  it('does not call it a conflict when both sides wrote the same thing', async () => {
    const graph = sample();
    await writeProject(dir, graph);
    graph.nodes[1].config.code = 'function run() { return { total: 3 }; }';
    await touch(join(dir, 'nodes/count/code.js'), `function run() { return { total: 3 }; }\n\n${RUN_ON_ITS_OWN}\n`);
    await expect(writeProject(dir, graph)).resolves.toBeUndefined();
  });

  it('reports what changed on disk once, and a deleted file as emptied', async () => {
    await writeProject(dir, sample());
    expect(await changesOnDisk(dir)).toEqual([]);

    await touch(join(dir, 'nodes/say/prompt.md'), 'You count carefully.\n');
    expect(await changesOnDisk(dir)).toEqual([{ node_id: 'say', field: 'prompt', value: 'You count carefully.' }]);
    expect(await changesOnDisk(dir)).toEqual([]);

    await rm(join(dir, 'nodes/count/output.js'));
    expect(await changesOnDisk(dir)).toEqual([{ node_id: 'count', field: 'output_definition', value: '' }]);

    // A change taken in is no conflict for the next save.
    const graph = await readProject(dir);
    await expect(writeProject(dir, graph)).resolves.toBeUndefined();
  });

  it('does not overwrite a node\'s interface changed outside since it was read', async () => {
    await writeProject(dir, sample());
    const graph = await readProject(dir);
    await touch(join(dir, 'nodes/count/interface.json'), '{"inputs": [], "outputs": [{"port": "total", "type": "number"}]}\n');
    await expect(writeProject(dir, graph)).rejects.toThrow(FileChanged);
    expect(JSON.parse(await text('nodes/count/interface.json')).outputs[0].type).toBe('number');
  });

  it('does not wipe a node another writer added, nor its folder', async () => {
    // The MCP server, or a second editor, adds node "extra" to the open project.
    await writeProject(dir, sample());
    const open = await readProject(dir);
    const flow = JSON.parse(await text('flow.json'));
    flow.nodes.extra = 'code';
    await touch(join(dir, 'flow.json'), JSON.stringify(flow, null, 2));
    await mkdir(join(dir, 'nodes/extra'), { recursive: true });
    await writeFile(join(dir, 'nodes/extra/code.js'), 'function run() { return { out: "somebody else" }; }\n');

    await expect(writeProject(dir, open)).rejects.toThrow(/flow\.json/);
    expect(JSON.parse(await text('flow.json')).nodes.extra).toBe('code');
    expect(existsSync(join(dir, 'nodes/extra/code.js'))).toBe(true);
  });

  it('does not write over a layout moved outside since it was read', async () => {
    await writeProject(dir, sample());
    const open = await readProject(dir);
    const layout = JSON.parse(await text('layout.json'));
    layout.count.x = 999;
    await touch(join(dir, 'layout.json'), JSON.stringify(layout, null, 2));
    await expect(writeProject(dir, open)).rejects.toThrow(/layout\.json/);
  });
});

/**
 * A node that holds a graph holds a project folder: the same rules one level
 * down, and no second way of storing a graph.
 */
describe('a graph inside a node', () => {
  const nested = (): Graph => parseGraph({
    metadata: { name: 'Outer' },
    nodes: [
      {
        id: 'part', node_type: 'subgraph', label: 'The hard part', position: { x: 10, y: 10 },
        inputs: [], outputs: [],
        description: 'Summarise a paper.',
        config: {
          subgraph: {
            metadata: { name: 'Inner' },
            nodes: [
              {
                id: 'shorten', node_type: 'code', label: 'Shorten', position: { x: 5, y: 5 },
                inputs: [port('text', 'input')], outputs: [port('short', 'output')],
                config: { code: 'function run(i) { return { short: i.text.slice(0, 10) }; }' },
              },
            ],
            edges: [],
          },
        },
      },
    ],
    edges: [],
  });

  it('is a project folder of its own, and is out of the node.json above it', async () => {
    await writeProject(dir, nested());

    expect(JSON.parse(await text('nodes/part/flow.json')).name).toBe('Inner');
    // The inner node's body is a file down there, the same as anywhere else.
    expect(await text('nodes/part/nodes/shorten/code.js')).toContain('i.text.slice');
    expect(JSON.parse(await text('nodes/part/layout.json')).shorten).toEqual({ x: 5, y: 5 });
    // And none of it is repeated above.
    expect(JSON.parse(await text('nodes/part/node.json')).config).toEqual({});
  });

  it('reads back whole, body and all', async () => {
    await writeProject(dir, nested());
    const read = await readProject(dir);
    const inner = read.nodes[0].config.subgraph as Graph;
    expect(inner.metadata.name).toBe('Inner');
    expect(inner.nodes[0].config.code).toContain('i.text.slice');
    expect(inner.nodes[0].position).toEqual({ x: 5, y: 5 });
  });

  it('can be opened on its own, because it is an ordinary project', async () => {
    await writeProject(dir, nested());
    expect(isProjectFolder(join(dir, 'nodes/part'))).toBe(true);
    const alone = await loadGraph(join(dir, 'nodes/part'));
    expect(alone.nodes.map((node) => node.id)).toEqual(['shorten']);
  });

  it('keeps the inner files when the graph above it is saved again', async () => {
    // `tidy` must not walk into a folder that is somebody else's project: from
    // up here, an inner code.js looks like a file nothing claims.
    await writeProject(dir, nested());
    await writeProject(dir, await readProject(dir));
    expect(existsSync(join(dir, 'nodes/part/nodes/shorten/code.js'))).toBe(true);
  });

  it('reports a change anywhere inside it as that graph having changed', async () => {
    await writeProject(dir, nested());
    expect(await changesOnDisk(dir)).toEqual([]);

    await touch(join(dir, 'nodes/part/nodes/shorten/code.js'), 'function run() { return { short: "hi" }; }\n');
    const [change, ...rest] = await changesOnDisk(dir);
    expect(rest).toEqual([]);
    expect(change).toMatchObject({ node_id: 'part', field: 'nested_graph' });
    expect((change.value as Graph).nodes[0].config.code).toContain('"hi"');
    // Once, like every other change.
    expect(await changesOnDisk(dir)).toEqual([]);
  });
});

/**
 * What a save must not do once a project is a tree: write half of it, and
 * leave behind what no node claims any more.
 */
describe('saving a project that holds a project', () => {
  const holder = (id: string, inner: unknown, extra: Record<string, unknown> = {}) => ({
    id, node_type: 'subgraph', label: id, position: { x: 0, y: 0 }, inputs: [], outputs: [],
    config: { subgraph: inner, ...extra },
  });
  const body = (id: string) => ({
    metadata: { name: id },
    nodes: [{
      id: 'shorten', node_type: 'code', label: 'Shorten', position: { x: 0, y: 0 },
      inputs: [port('text', 'input')], outputs: [port('short', 'output')],
      config: { code: `function run() { return { short: '${id}' }; }` },
    }],
    edges: [],
  });

  it('gives up the whole folder of a node that no longer holds a graph', async () => {
    const graph = parseGraph({ metadata: { name: 'Outer' }, nodes: [holder('part', body('part'))], edges: [] });
    await writeProject(dir, graph);
    expect(existsSync(join(dir, 'nodes/part/nodes/shorten/code.js'))).toBe(true);

    // The node is gone. Its folder was a project of its own, which is no
    // reason to keep it: nothing in flow.json claims it any more.
    graph.nodes = [];
    await writeProject(dir, graph);
    expect(existsSync(join(dir, 'nodes/part'))).toBe(false);
  });

  it('gives it up when the node with that id no longer holds one either', async () => {
    const graph = parseGraph({ metadata: { name: 'Outer' }, nodes: [holder('part', body('part'))], edges: [] });
    await writeProject(dir, graph);

    graph.nodes = [{
      ...graph.nodes[0], node_type: 'code', inputs: [], outputs: [port('output', 'output')],
      config: { code: 'function run() { return { output: 1 }; }' },
    }] as Graph['nodes'];
    await writeProject(dir, graph);
    expect(existsSync(join(dir, 'nodes/part/flow.json'))).toBe(false);
    expect(await text('nodes/part/code.js')).toContain('output: 1');
  });

  it('writes nothing at all when two ids would share a folder', async () => {
    const graph = parseGraph({
      metadata: { name: 'Outer' },
      nodes: [holder('a/b', body('one')), holder('a:b', body('two'))],
      edges: [],
    });
    await expect(writeProject(dir, graph)).rejects.toThrow(/share a folder/);
    // Not one folder written, not one flow.json: the save was refused before
    // anything happened, which is what "look first, write after" means.
    expect(existsSync(join(dir, 'nodes/a_b'))).toBe(false);
    expect(existsSync(join(dir, 'flow.json'))).toBe(false);
  });

  it('writes nothing at all when a file up here changed under it', async () => {
    const graph = parseGraph({
      metadata: { name: 'Outer' },
      nodes: [
        holder('part', body('part')),
        {
          id: 'note', node_type: 'code', label: 'Note', position: { x: 0, y: 0 },
          inputs: [], outputs: [port('output', 'output')], config: { code: 'function run() { return {}; }' },
        },
      ],
      edges: [],
    });
    await writeProject(dir, graph);
    await touch(join(dir, 'nodes/note/code.js'), 'function run() { return { mine: true }; }\n');

    // The inner graph changed in the editor, and an outer file changed on
    // disk. The save is refused -- and the inner folder still holds what it
    // held, rather than half of the next version.
    graph.nodes[0].config.subgraph = body('changed');
    await expect(writeProject(dir, graph)).rejects.toThrow(/was changed outside the editor/);
    expect(await text('nodes/part/nodes/shorten/code.js')).toContain("'part'");
  });

  it('names a file deep inside by the path a person would look for', async () => {
    const graph = parseGraph({ metadata: { name: 'Outer' }, nodes: [holder('part', body('part'))], edges: [] });
    await writeProject(dir, graph);
    await touch(join(dir, 'nodes/part/nodes/shorten/code.js'), 'function run() { return { short: "theirs" }; }\n');

    graph.nodes[0].config.subgraph = body('mine');
    await expect(writeProject(dir, graph)).rejects.toThrow(/nodes\/part\/nodes\/shorten\/code\.js/);
  });
});

describe('looking for what changed, when a graph inside cannot be read at all', () => {
  it('says so, rather than swallowing it as if it were half-written', async () => {
    const graph = parseGraph({
      metadata: { name: 'Outer' },
      nodes: [{
        id: 'part', node_type: 'subgraph', label: 'Part', position: { x: 0, y: 0 }, inputs: [], outputs: [],
        config: { subgraph: { metadata: { name: 'Inner' }, nodes: [{ id: 'inner', node_type: 'code', config: { code: 'x' } }], edges: [] } },
      }],
      edges: [],
    });
    await writeProject(dir, graph);
    // Where its code should be there is a folder: no editor ever half-writes that.
    await rm(join(dir, 'nodes/part/nodes/inner/code.js'));
    await mkdir(join(dir, 'nodes/part/nodes/inner/code.js'));
    await expect(changesOnDisk(dir)).rejects.toThrow(/EISDIR|illegal operation/);
  });
});

describe('looking for what changed, while someone else is writing', () => {
  it('still hands over what it found when a graph inside is caught half-written', async () => {
    const graph = parseGraph({
      metadata: { name: 'Outer' },
      nodes: [
        {
          id: 'part', node_type: 'subgraph', label: 'Part', position: { x: 0, y: 0 }, inputs: [], outputs: [],
          config: { subgraph: { metadata: { name: 'Inner' }, nodes: [], edges: [] } },
        },
        {
          id: 'note', node_type: 'code', label: 'Note', position: { x: 0, y: 0 },
          inputs: [], outputs: [port('output', 'output')], config: { code: 'function run() { return {}; }' },
        },
      ],
      edges: [],
    });
    await writeProject(dir, graph);
    expect(await changesOnDisk(dir)).toEqual([]);

    await touch(join(dir, 'nodes/note/code.js'), 'function run() { return { mine: true }; }\n');
    await touch(join(dir, 'nodes/part/flow.json'), '{ "nodes": {');

    // The half-written file is skipped, and the change that *was* found comes
    // back rather than being lost with the exception.
    const changes = await changesOnDisk(dir);
    expect(changes.map((change) => change.node_id)).toEqual(['note']);

    // And once the other editor has finished, the graph inside is reported too.
    await touch(join(dir, 'nodes/part/flow.json'), JSON.stringify({ name: 'Mended', nodes: {}, wires: [] }));
    const after = await changesOnDisk(dir);
    expect(after.map((change) => change.field)).toEqual(['nested_graph']);
  });
});
