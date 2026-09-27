import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InputNodeRunner } from './InputNodeRunner.ts';
import type { Runtime } from '../../Runtime.ts';
import { quietRuntime } from '../../../../test/fakes.ts';
import { parseGraph, type Graph, type GraphNode } from '../../../graph.ts';
import { forgetSeen, writeProject } from '../../../project/folder.ts';

/**
 * A read that fails: a missing file, an unreadable folder.
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

describe('an error port', () => {
  it('is not declared when catch_errors is off', () => {
    const element = new InputNodeRunner();
    const ports = element.derivedPorts(inputNode({ input_mode: 'file', value: '/x' }));
    expect(ports?.outputs.map((p) => p.id)).not.toContain('error');
  });

  it('is declared for file and directory modes when catch_errors is on, not for text', () => {
    const element = new InputNodeRunner();
    expect(element.derivedPorts(inputNode({ input_mode: 'file', catch_errors: true }))?.outputs.map((p) => p.id))
      .toContain('error');
    expect(element.derivedPorts(inputNode({ input_mode: 'directory', catch_errors: true }))?.outputs.map((p) => p.id))
      .toContain('error');
    expect(element.derivedPorts(inputNode({ input_mode: 'text', catch_errors: true }))?.outputs.map((p) => p.id))
      .not.toContain('error');
  });
});

describe('where it reads', () => {
  const reads: Runtime = {
    ...broken,
    files: { ...broken.files, read: async (path: string) => `contents of ${path}` },
  };

  it('takes the wired path over the configured one, as the port promises', async () => {
    const element = new InputNodeRunner();
    const result = await element.execute(
      inputNode({ input_mode: 'file', value: '/configured.txt' }),
      { path: '/wired.txt' },
      reads,
    );
    expect(result).toEqual({ content: 'contents of /wired.txt', path: '/wired.txt' });
  });

  it('falls back to the configured path when the wire brought nothing', async () => {
    const element = new InputNodeRunner();
    for (const arrived of [{}, { path: '' }, { path: '   ' }, { path: null }]) {
      const result = await element.execute(inputNode({ input_mode: 'file', value: '/configured.txt' }), arrived, reads);
      expect(result).toMatchObject({ path: '/configured.txt' });
    }
  });
});

describe('a file that cannot be read', () => {
  // It throws either way; the executor decides what that costs. See executor.test.ts.
  it('throws, whatever catch_errors says', async () => {
    const element = new InputNodeRunner();
    await expect(element.execute(inputNode({ input_mode: 'file', value: '/gone.txt' }), {}, broken))
      .rejects.toThrow('ENOENT');
    await expect(element.execute(inputNode({ input_mode: 'file', value: '/gone.txt', catch_errors: true }), {}, broken))
      .rejects.toThrow('ENOENT');
  });

  it('reports an empty error alongside a real read', async () => {
    const element = new InputNodeRunner();
    const okay: Runtime = { ...broken, files: { ...broken.files, resolve: (p) => p, read: async () => 'hi' } };
    const result = await element.execute(inputNode({ input_mode: 'file', value: '/x.txt', catch_errors: true }), {}, okay);
    expect(result).toEqual({ content: 'hi', path: '/x.txt', error: '' });
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

  it('keeps no file of its own in a project folder, whatever an old node still carries', async () => {
    const element = new InputNodeRunner();
    const old = { input_mode: 'directory', value: 'data', selector_code: 'function run(i) { return i; }', selector_prompt: 'Only the CSVs.' };
    expect(element.texts(inputNode(old))).toEqual([]);
    expect(element.logic(inputNode(old))).toBeUndefined();
    const graph: Graph = parseGraph({ nodes: [{ ...inputNode(old), id: 'source' }], edges: [] });
    await writeProject(dir, graph);
    expect(existsSync(join(dir, 'nodes', 'source', 'select.js'))).toBe(false);
    expect(existsSync(join(dir, 'nodes', 'source', 'task.md'))).toBe(false);
  });
});

describe('what it hands on', () => {
  it('counts a folder\'s files as a number, and says so on its port', async () => {
    const element = new InputNodeRunner();
    const listing: Runtime = { ...broken, files: { ...broken.files, list: async () => ['/d/a.txt', '/d/b.txt'] } };
    const result = await element.execute(inputNode({ input_mode: 'directory', value: '/d' }), {}, listing);
    expect(result).toMatchObject({ files: ['/d/a.txt', '/d/b.txt'], count: 2 });
    const count = element.derivedPorts(inputNode({ input_mode: 'directory' }))!.outputs.find((port) => port.id === 'count');
    expect(count?.data_type).toBe('number');
  });

  it('hands on the text it holds in text mode, and nothing from a wire it does not have', async () => {
    // Text mode declares no inputs. A wire left on "path" from file mode used
    // to be handed on as the text whenever the box was empty.
    const element = new InputNodeRunner();
    expect(element.derivedPorts(inputNode({ input_mode: 'text' }))!.inputs).toEqual([]);
    expect(await element.execute(inputNode({ input_mode: 'text', value: 'hello' }), { path: '/elsewhere.txt' }, broken))
      .toEqual({ output: 'hello' });
    expect(await element.execute(inputNode({ input_mode: 'text', value: '' }), { path: '/elsewhere.txt', value: 'x' }, broken))
      .toEqual({ output: '' });
  });
});
