import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGraph, type Graph } from '../graph.ts';
import { NotAGraph } from '../errors.ts';
import { problemsIn } from './check.ts';
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
          code_prompt: 'Count the files.',
          output_schema: { type: 'object', properties: { total: { type: 'integer' } }, required: ['total'] },
          batch_mode: 'whole_list',
        },
      },
      {
        id: 'say', node_type: 'ai', label: 'Say it', position: { x: 600, y: 20 },
        inputs: [port('total', 'input')], outputs: [port('output', 'output')],
        config: {
          system_prompt: 'You report counts.', prompt_template: 'There are {{total}} files.',
          output_format_prompt: 'One sentence.', temperature: 0.2,
        },
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
    expect(await text('nodes/count/code.js')).toBe('function run(inputs) {\n  return { total: inputs.files.length };\n}\n');
    expect(await text('nodes/count/task.md')).toBe('Count the files.\n');
    expect(JSON.parse(await text('nodes/count/interface.json')).output_schema).toMatchObject({ properties: { total: { type: 'integer' } } });
    expect(await text('nodes/say/system.md')).toBe('You report counts.\n');
    expect(await text('nodes/say/message.md')).toBe('There are {{total}} files.\n');
    expect(await text('nodes/say/output.md')).toBe('One sentence.\n');
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

  it('has no file for empty writing, and removes the file of writing that was emptied', async () => {
    const graph = sample();
    await writeProject(dir, graph);
    graph.nodes[1].config.code_prompt = '';
    await writeProject(dir, graph);
    expect(existsSync(join(dir, 'nodes/count/task.md'))).toBe(false);
    expect(existsSync(join(dir, 'nodes/count/code.js'))).toBe(true);
  });

  it('removes a deleted node\'s files, and nothing a person put there', async () => {
    const graph = sample();
    await writeProject(dir, graph);
    await writeFile(join(dir, 'nodes/say/notes.txt'), 'mine');
    graph.nodes = graph.nodes.filter((node) => node.id !== 'say' && node.id !== 'count');
    graph.edges = [];
    await writeProject(dir, graph);
    expect(existsSync(join(dir, 'nodes/count'))).toBe(false);
    expect(existsSync(join(dir, 'nodes/say/system.md'))).toBe(false);
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
    await writeFile(join(dir, 'nodes/say/system.md'), 'Line one.\r\nLine two.\r\n');
    const read = await readProject(dir);
    expect(read.nodes.find((node) => node.id === 'say')!.config.system_prompt).toBe('Line one.\nLine two.');
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

/** The files a node's example reads: a folder of them, `nodes/<id>/example/`, and one setting in the graph. */
describe('a node\'s example files', () => {
  const withFiles = (files: Record<string, string>): Graph => {
    const graph = sample();
    graph.nodes[1].config.example_files = files;
    return graph;
  };
  const countOf = (graph: Graph) => graph.nodes.find((node) => node.id === 'count')!;

  it('are files in the node\'s example folder, byte for byte, and out of its node.json', async () => {
    await writeProject(dir, withFiles({ 'example/rows.csv': 'name\r\nAda\r\n', 'example/notes.txt': '﻿no newline at the end' }));
    expect(await readFile(join(dir, 'nodes/count/example/rows.csv'), 'utf8')).toBe('name\r\nAda\r\n');
    expect(await readFile(join(dir, 'nodes/count/example/notes.txt'), 'utf8')).toBe('﻿no newline at the end');
    expect(JSON.parse(await text('nodes/count/node.json')).config).not.toHaveProperty('example_files');
  });

  it('read back as they were written', async () => {
    const files = { 'example/rows.csv': 'name\r\nAda\r\n', 'example/notes.txt': '﻿no newline at the end' };
    await writeProject(dir, withFiles(files));
    forgetSeen();
    expect(countOf(await readProject(dir)).config.example_files).toEqual(files);
    // A node without any has none.
    expect((await readProject(dir)).nodes.find((node) => node.id === 'say')!.config).not.toHaveProperty('example_files');
  });

  it('go when the node no longer holds them -- and a file somebody dropped in since stays', async () => {
    const graph = withFiles({ 'example/a.csv': 'a', 'example/b.csv': 'b' });
    await writeProject(dir, graph);
    await writeFile(join(dir, 'nodes/count/example/mine.csv'), 'mine');
    graph.nodes[1].config.example_files = { 'example/a.csv': 'a' };
    await writeProject(dir, graph);
    expect(existsSync(join(dir, 'nodes/count/example/b.csv'))).toBe(false);
    expect(await text('nodes/count/example/a.csv')).toBe('a');
    expect(await text('nodes/count/example/mine.csv')).toBe('mine');
    delete graph.nodes[1].config.example_files;
    await writeProject(dir, graph);
    expect(existsSync(join(dir, 'nodes/count/example/a.csv'))).toBe(false);
    expect(await text('nodes/count/example/mine.csv')).toBe('mine');
  });

  it('are only the text in the folder: a picture there is left alone, and never tidied away', async () => {
    await writeProject(dir, withFiles({ 'example/a.csv': 'a' }));
    await writeFile(join(dir, 'nodes/count/example/photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]));
    forgetSeen();
    const read = await readProject(dir);
    expect(countOf(read).config.example_files).toEqual({ 'example/a.csv': 'a' });
    await writeProject(dir, read);
    expect(await readFile(join(dir, 'nodes/count/example/photo.png'))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]));
    expect(await changesOnDisk(dir)).toEqual([]);
  });

  it('are refused, before anything is written, when one is named so it could not be', async () => {
    await expect(writeProject(dir, withFiles({ 'example/../code.js': 'x' }))).rejects.toThrow(/"example\/\.\.\/code\.js" among them/);
    expect(existsSync(join(dir, 'flow.json'))).toBe(false);
  });

  it('come back as one change, the whole of what is there now, when one changes, comes or goes', async () => {
    await writeProject(dir, withFiles({ 'example/a.csv': 'a', 'example/b.csv': 'b' }));
    expect(await changesOnDisk(dir)).toEqual([]);

    await touch(join(dir, 'nodes/count/example/a.csv'), 'a, changed');
    expect(await changesOnDisk(dir)).toEqual([
      { node_id: 'count', field: 'example_files', value: { 'example/a.csv': 'a, changed', 'example/b.csv': 'b' } },
    ]);
    expect(await changesOnDisk(dir)).toEqual([]);

    await rm(join(dir, 'nodes/count/example/b.csv'));
    await writeFile(join(dir, 'nodes/count/example/c.csv'), 'c');
    expect(await changesOnDisk(dir)).toEqual([
      { node_id: 'count', field: 'example_files', value: { 'example/a.csv': 'a, changed', 'example/c.csv': 'c' } },
    ]);
    expect(await changesOnDisk(dir)).toEqual([]);

    // Taken in, they are no conflict for the next save.
    await expect(writeProject(dir, await readProject(dir))).resolves.toBeUndefined();
  });

  it('can be opened, as can each text the node keeps -- and nothing else of its folder', async () => {
    await writeProject(dir, withFiles({ 'example/a.csv': 'a' }));
    expect(await nodeFileOf(dir, 'count')).toBe('count/code.js');
    expect(await nodeFileOf(dir, 'count', 'example/a.csv')).toBe('count/example/a.csv');
    expect(await nodeFileOf(dir, 'count', 'example\\a.csv')).toBe('count/example/a.csv');
    // A text nobody has written yet is made, empty, so there is something to open.
    expect(await nodeFileOf(dir, 'say', 'examples.md')).toBe('say/examples.md');
    expect(await text('nodes/say/examples.md')).toBe('');
    await expect(nodeFileOf(dir, 'count', 'example/gone.csv')).rejects.toThrow(/no example file example\/gone\.csv yet/);
    for (const file of ['node.json', '../say/system.md', 'example/../code.js']) {
      await expect(nodeFileOf(dir, 'count', file), file).rejects.toThrow(/is not one of the files of "count": it keeps code\.js/);
    }
  });

  it('refuse a save over one changed outside since it was read', async () => {
    const graph = withFiles({ 'example/a.csv': 'a' });
    await writeProject(dir, graph);
    await touch(join(dir, 'nodes/count/example/a.csv'), 'theirs');
    graph.nodes[1].config.example_files = { 'example/a.csv': 'mine' };
    await expect(writeProject(dir, graph)).rejects.toThrow(/nodes\/count\/example\/a\.csv/);
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
    await touch(join(dir, 'nodes/count/code.js'), 'function run() { return { total: 3 }; }\n');
    await expect(writeProject(dir, graph)).resolves.toBeUndefined();
  });

  it('reports what changed on disk once, and a deleted file as emptied', async () => {
    await writeProject(dir, sample());
    expect(await changesOnDisk(dir)).toEqual([]);

    await touch(join(dir, 'nodes/say/system.md'), 'You count carefully.\n');
    expect(await changesOnDisk(dir)).toEqual([{ node_id: 'say', field: 'system_prompt', value: 'You count carefully.' }]);
    expect(await changesOnDisk(dir)).toEqual([]);

    await rm(join(dir, 'nodes/count/task.md'));
    expect(await changesOnDisk(dir)).toEqual([{ node_id: 'count', field: 'code_prompt', value: '' }]);

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
        config: {
          task: 'Summarise a paper.',
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

    expect(await text('nodes/part/task.md')).toBe('Summarise a paper.\n');
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
