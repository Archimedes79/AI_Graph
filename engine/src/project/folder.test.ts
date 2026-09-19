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

  it('still opens a graph saved with its code beside it the old way', async () => {
    const graph = sample();
    graph.nodes[1].config = { code_file: 'Count.js', code: '' };
    await writeFile(join(dir, 'old.json'), JSON.stringify(graph));
    await mkdir(join(dir, 'old.nodes'));
    await writeFile(join(dir, 'old.nodes', 'Count.js'),
      '// --- ai-graph ---------\n// node:    Count\n// ------------------------\n\nfunction run() { return { total: 7 }; }\n');
    const read = await loadGraph(join(dir, 'old.json'));
    expect(read.nodes[1].config.code).toBe('function run() { return { total: 7 }; }');
    expect(read.nodes[1].config).not.toHaveProperty('code_file');
  });
});

describe('two editors on one folder', () => {
  /** A distinct modification time, so a change within the same millisecond still shows. */
  const touch = async (path: string, content: string) => {
    await writeFile(path, content);
    const later = new Date(Date.now() + 5_000);
    await utimes(path, later, later);
  };

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
