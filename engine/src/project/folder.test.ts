import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGraph, type Graph } from '../graph.ts';
import {
  FileChanged, changesOnDisk, forgetSeen, isProjectFolder, loadGraph, projectFolderOf, readProject, saveGraph, writeProject,
} from './folder.ts';

const port = (id: string, kind: 'input' | 'output') => ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '' });

/** One of each element that keeps writing: a code node, an ai node, a directory input, a page with a chart. */
function sample(): Graph {
  return parseGraph({
    metadata: { name: 'Sample', description: 'All the writing there is.' },
    nodes: [
      {
        id: 'folder', node_type: 'input', label: 'Folder', position: { x: 10, y: 20 },
        inputs: [], outputs: [port('files', 'output')],
        config: { input_mode: 'directory', value: 'data', selector_code: 'function run(i) { return { files: i.files }; }', selector_prompt: 'Only the CSVs.' },
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
          output_format: 'text', output_format_prompt: 'One sentence.', temperature: 0.2,
        },
      },
      {
        id: 'page', node_type: 'gui', label: 'Page', position: { x: 900, y: 20 },
        inputs: [port('chart_in', 'input')], outputs: [],
        config: { gui_widgets: [{ id: 'chart', kind: 'plot_window', label: 'Chart', code: 'function run(i) { return i; }', code_prompt: 'Bars.' }] },
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
    expect(JSON.parse(await text('nodes/count/output.schema.json'))).toMatchObject({ properties: { total: { type: 'integer' } } });
    expect(await text('nodes/say/system.md')).toBe('You report counts.\n');
    expect(await text('nodes/say/message.md')).toBe('There are {{total}} files.\n');
    expect(await text('nodes/say/output.md')).toBe('One sentence.\n');
    expect(await text('nodes/folder/select.js')).toContain('i.files');
    expect(await text('nodes/page/chart/code.js')).toContain('return i');
    expect(await text('nodes/page/chart/task.md')).toBe('Bars.\n');
  });

  it('leaves the writing and the positions out of graph.json, and the settings in', async () => {
    await writeProject(dir, sample());
    const wiring = JSON.parse(await text('graph.json'));
    const count = wiring.nodes.find((n: { id: string }) => n.id === 'count');
    expect(count.config).toEqual({ batch_mode: 'whole_list' });
    expect(count).not.toHaveProperty('position');
    expect(wiring.nodes.find((n: { id: string }) => n.id === 'say').config).toEqual({ output_format: 'text', temperature: 0.2 });
    expect(wiring.nodes.find((n: { id: string }) => n.id === 'page').config.gui_widgets[0]).toEqual({ id: 'chart', kind: 'plot_window', label: 'Chart' });
    expect(JSON.parse(await text('layout.json')).count).toEqual({ x: 300, y: 20, width: 360, height: 180 });
  });

  it('reads back exactly what was written', async () => {
    const original = sample();
    await writeProject(dir, original);
    const read = await readProject(dir);
    original.nodes[1].position.x = 300; // stored rounded
    expect(read.nodes).toEqual(original.nodes.map((node) => ({ ...node, width: node.width ?? null, height: node.height ?? null })));
    expect(read.edges).toEqual(original.edges);
    expect(read.metadata.name).toBe('Sample');
  });

  it('writes the same bytes for the same graph, so an unchanged save is no change', async () => {
    await writeProject(dir, sample());
    const first = [await text('graph.json'), await text('layout.json')];
    await writeProject(dir, await readProject(dir));
    expect([await text('graph.json'), await text('layout.json')]).toEqual(first);
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

  it('takes a file edited in another editor, with Windows line endings and a final newline', async () => {
    await writeProject(dir, sample());
    await writeFile(join(dir, 'nodes/say/system.md'), 'Line one.\r\nLine two.\r\n');
    const read = await readProject(dir);
    expect(read.nodes.find((node) => node.id === 'say')!.config.system_prompt).toBe('Line one.\nLine two.');
  });

  it('opens a folder whose graph.json carries everything inline -- a deploy bundle', async () => {
    const graph = sample();
    await writeFile(join(dir, 'graph.json'), JSON.stringify(graph));
    expect(isProjectFolder(dir)).toBe(true);
    const read = await loadGraph(dir);
    expect(read.nodes[1].config.code).toContain('inputs.files.length');
  });
});

describe('finding a project', () => {
  it('is the folder, or its graph.json named directly', async () => {
    await writeProject(dir, sample());
    expect(projectFolderOf(dir)).toBe(dir);
    expect(projectFolderOf(join(dir, 'graph.json'))).toBe(dir);
    expect((await loadGraph(join(dir, 'graph.json'))).nodes).toHaveLength(4);
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
    expect(await changesOnDisk(dir)).toEqual([{ node_id: 'say', widget_id: '', field: 'system_prompt', value: 'You count carefully.' }]);
    expect(await changesOnDisk(dir)).toEqual([]);

    await rm(join(dir, 'nodes/page/chart/task.md'));
    expect(await changesOnDisk(dir)).toEqual([{ node_id: 'page', widget_id: 'chart', field: 'code_prompt', value: '' }]);

    // A change taken in is no conflict for the next save.
    const graph = await readProject(dir);
    await expect(writeProject(dir, graph)).resolves.toBeUndefined();
  });

  it('reads a newly written interface file as JSON', async () => {
    await writeProject(dir, sample());
    await touch(join(dir, 'nodes/count/output.schema.json'), '{"type": "object"}\n');
    expect(await changesOnDisk(dir)).toEqual([{ node_id: 'count', widget_id: '', field: 'output_schema', value: { type: 'object' } }]);
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

  it('is a project folder of its own, and is out of the graph.json above it', async () => {
    await writeProject(dir, nested());

    expect(await text('nodes/part/task.md')).toBe('Summarise a paper.\n');
    expect(JSON.parse(await text('nodes/part/graph.json')).metadata.name).toBe('Inner');
    // The inner node's body is a file down there, the same as anywhere else.
    expect(await text('nodes/part/nodes/shorten/code.js')).toContain('i.text.slice');
    expect(JSON.parse(await text('nodes/part/layout.json')).shorten).toEqual({ x: 5, y: 5 });
    // And none of it is repeated above.
    expect(JSON.parse(await text('graph.json')).nodes[0].config).toEqual({});
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
    expect(change).toMatchObject({ node_id: 'part', widget_id: '', field: 'nested_graph' });
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
    // reason to keep it: nothing in graph.json claims it any more.
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
    expect(existsSync(join(dir, 'nodes/part/graph.json'))).toBe(false);
    expect(await text('nodes/part/code.js')).toContain('output: 1');
  });

  it('writes nothing at all when two ids would share a folder', async () => {
    const graph = parseGraph({
      metadata: { name: 'Outer' },
      nodes: [holder('a/b', body('one')), holder('a:b', body('two'))],
      edges: [],
    });
    await expect(writeProject(dir, graph)).rejects.toThrow(/share the folder/);
    // Not one folder written, not one graph.json: the save was refused before
    // anything happened, which is what "look first, write after" means.
    expect(existsSync(join(dir, 'nodes/a_b'))).toBe(false);
    expect(existsSync(join(dir, 'graph.json'))).toBe(false);
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
    await touch(join(dir, 'nodes/part/graph.json'), '{ "nodes": [');

    // The half-written file is skipped, and the change that *was* found comes
    // back rather than being lost with the exception.
    const changes = await changesOnDisk(dir);
    expect(changes.map((change) => change.node_id)).toEqual(['note']);

    // And once the other editor has finished, the graph inside is reported too.
    await touch(join(dir, 'nodes/part/graph.json'), JSON.stringify({ metadata: { name: 'Mended' }, nodes: [], edges: [] }));
    const after = await changesOnDisk(dir);
    expect(after.map((change) => change.field)).toEqual(['nested_graph']);
  });
});
