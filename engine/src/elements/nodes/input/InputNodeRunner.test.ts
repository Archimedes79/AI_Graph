import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InputNodeRunner } from './InputNodeRunner.ts';
import type { Runtime } from '../../Runtime.ts';
import { edge, graphOf, quietRuntime } from '../../../../test/fakes.ts';
import { parseGraph, type Graph, type GraphNode } from '../../../graph.ts';
import { forgetSeen, writeProject } from '../../../project/folder.ts';
import { executeGraph } from '../../../execution/executor.ts';
import { registry } from '../../registry.ts';

/**
 * A listing that fails: a folder that is not there.
 *
 * Off by default, the node fails the way it always did. On, the failure
 * becomes an `error` port instead -- declared only then, so a graph that never
 * asked for one is not handed a port nobody wired.
 */

function inputNode(config: Record<string, unknown>): GraphNode {
  return {
    id: 'src', node_type: 'input', label: 'Source', description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
  };
}

const broken = quietRuntime({
  files: {
    exists: async () => false,
    read: async () => { throw new Error('ENOENT: no such file'); },
    list: async () => { throw new Error('ENOENT: no such directory'); },
  },
});

const element = new InputNodeRunner();

describe('an error port', () => {
  it('is not declared when catch_errors is off', () => {
    const ports = element.derivedPorts(inputNode({ input_mode: 'directory', value: '/x' }));
    expect(ports?.outputs.map((p) => p.id)).not.toContain('error');
  });

  it('is declared for a folder when catch_errors is on, not for text', () => {
    expect(element.derivedPorts(inputNode({ input_mode: 'directory', catch_errors: true }))?.outputs.map((p) => p.id))
      .toContain('error');
    expect(element.derivedPorts(inputNode({ input_mode: 'text', catch_errors: true }))?.outputs.map((p) => p.id))
      .not.toContain('error');
  });
});

describe('where it lists', () => {
  const lists: Runtime = {
    ...broken,
    files: { ...broken.files, list: async (folder: string) => [`${folder}/a.txt`] },
  };

  it('takes the wired path over the configured one, as the port promises', async () => {
    const result = await element.execute(inputNode({ input_mode: 'directory', value: '/configured' }), { path: '/wired' }, lists);
    expect(result).toEqual({ files: ['/wired/a.txt'], count: 1 });
  });

  it('falls back to the configured path when the wire brought nothing', async () => {
    for (const arrived of [{}, { path: '' }, { path: '   ' }, { path: null }]) {
      const result = await element.execute(inputNode({ input_mode: 'directory', value: '/configured' }), arrived, lists);
      expect(result).toMatchObject({ files: ['/configured/a.txt'] });
    }
  });

  it('lists nothing, and fails at nothing, where no folder is named', async () => {
    expect(await element.execute(inputNode({ input_mode: 'directory', catch_errors: true }), {}, broken))
      .toEqual({ files: [], count: 0, error: '' });
  });
});

describe('a folder that cannot be listed', () => {
  // It throws either way; the executor decides what that costs. See executor.test.ts.
  it('throws, whatever catch_errors says', async () => {
    await expect(element.execute(inputNode({ input_mode: 'directory', value: '/gone' }), {}, broken))
      .rejects.toThrow('ENOENT');
    await expect(element.execute(inputNode({ input_mode: 'directory', value: '/gone', catch_errors: true }), {}, broken))
      .rejects.toThrow('ENOENT');
  });
});

describe('a folder it lists', () => {
  /** Nothing is written beside a listing: no body chooses its files, a code node after it does. */
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ai-graph-input-'));
    forgetSeen();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps no file of its own in a project folder: it is its settings', async () => {
    const folder = { input_mode: 'directory', value: 'data' };
    expect(element.texts(inputNode(folder))).toEqual([]);
    expect(element.logic(inputNode(folder))).toBeUndefined();
    const graph: Graph = parseGraph({ nodes: [{ ...inputNode(folder), id: 'source' }], edges: [] });
    await writeProject(dir, graph);
    expect(readdirSync(join(dir, 'nodes', 'source')).sort()).toEqual(['interface.json', 'node.json']);
  });
});

describe('what it hands on', () => {
  it('counts a folder\'s files as a number, and says so on its port', async () => {
    const listing: Runtime = { ...broken, files: { ...broken.files, list: async () => ['/d/a.txt', '/d/b.txt'] } };
    const result = await element.execute(inputNode({ input_mode: 'directory', value: '/d' }), {}, listing);
    expect(result).toMatchObject({ files: ['/d/a.txt', '/d/b.txt'], count: 2 });
    const count = element.derivedPorts(inputNode({ input_mode: 'directory' }))!.outputs.find((port) => port.id === 'count');
    expect(count?.data_type).toBe('number');
  });

  it('hands on the text it holds in text mode, and nothing from a wire it does not have', async () => {
    // Text mode declares no inputs. A wire left on "path" from a folder used
    // to be handed on as the text whenever the box was empty.
    expect(element.derivedPorts(inputNode({ input_mode: 'text' }))!.inputs).toEqual([]);
    expect(await element.execute(inputNode({ input_mode: 'text', value: 'hello' }), { path: '/elsewhere.txt' }, broken))
      .toEqual({ output: 'hello' });
    expect(await element.execute(inputNode({ input_mode: 'text', value: '' }), { path: '/elsewhere.txt', value: 'x' }, broken))
      .toEqual({ output: '' });
  });

  it('reads no file: a path it holds is handed on as text, for the node that reads it', async () => {
    // It had a mode that read one file into "content". Reading is the reading
    // node's own input now ("Read the file at this path"), so an input that
    // names a file is a text holding its path.
    const named = inputNode({ input_mode: 'text', value: 'data/people.csv' });
    expect(await element.execute(named, {}, broken)).toEqual({ output: 'data/people.csv' });
    expect(element.whatRuns(named).does).not.toMatch(/reads/i);
    expect(element.graphAuthorNote()).not.toMatch(/"file"|content/);
  });

  it('names a file for the node that reads it: wired into an input that reads its file, the file\'s text arrives there', async () => {
    const port = (id: string, kind: 'input' | 'output', data_type: string) =>
      ({ id, name: id, kind, data_type, multi: false, required: false, description: '' });
    const graph = graphOf([
      { ...inputNode({ input_mode: 'text', value: 'data/people.csv' }), outputs: [port('output', 'output', 'text')] } as GraphNode,
      {
        id: 'reader', node_type: 'code', label: 'Reader', description: '', position: { x: 0, y: 0 },
        inputs: [port('file', 'input', 'file_path')], outputs: [port('rows', 'output', 'text')],
        config: { code: 'function run(inputs) { return { rows: inputs.file }; }' },
      } as GraphNode,
    ], [edge('e', 'src', 'output', 'reader', 'file')]);
    const runtime = quietRuntime({
      files: { read: async (path: string) => `the text of ${path}` },
      code: { run: async (_body, inputs) => ({ rows: inputs.file }) },
    });
    const result = await executeGraph(graph, { registry, runtime });
    expect(result.node_results.find((r) => r.node_id === 'reader')?.outputs).toEqual({ rows: 'the text of data/people.csv' });
  });
});
