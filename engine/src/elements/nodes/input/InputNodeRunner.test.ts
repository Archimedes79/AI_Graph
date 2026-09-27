import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InputNodeRunner } from './InputNodeRunner.ts';
import type { Runtime } from '../../Runtime.ts';
import { parseGraph, type Graph, type GraphNode } from '../../../graph.ts';
import { forgetSeen, readProject, writeProject } from '../../../project/folder.ts';

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

const broken: Runtime = {
  files: {
    resolve: (p) => p,
    exists: async () => false,
    read: async () => { throw new Error('ENOENT: no such file'); },
    write: async () => {},
    list: async () => { throw new Error('ENOENT: no such directory'); },
  },
  code: { run: async (_body, inputs) => inputs },
  ai: { complete: async () => '' },
};

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

describe('the selector', () => {
  /**
   * Only a folder listing is narrowed by a selector. The editor gave every
   * input node the starter selector, and a text or single-file input used to
   * have it written into its folder as `select.js`: a file that never runs,
   * saying the node chooses files.
   */
  const starter = 'function run(inputs) {\n  return { files: inputs.files ?? [] };\n}\n';

  it('is kept in a file of its own only by a node that lists a folder', () => {
    const element = new InputNodeRunner();
    for (const mode of ['text', 'file']) {
      expect(element.texts(inputNode({ input_mode: mode, selector_code: starter })), mode).toEqual([]);
    }
    expect(element.texts(inputNode({ input_mode: 'directory', selector_code: starter })).map((text) => text.file))
      .toEqual(['select.js', 'task.md']);
  });

  describe('in a project folder', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'ai-graph-input-'));
      forgetSeen();
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    const graphWith = (mode: string): Graph => parseGraph({
      nodes: [{
        id: 'source', node_type: 'input', label: 'Source', position: { x: 0, y: 0 }, inputs: [], outputs: [],
        config: { input_mode: mode, value: 'data', selector_code: starter },
      }],
      edges: [],
    });

    it('writes no select.js for a text or file input', async () => {
      for (const mode of ['text', 'file']) {
        await writeProject(dir, graphWith(mode));
        expect(existsSync(join(dir, 'nodes', 'source', 'select.js')), mode).toBe(false);
      }
    });

    it('tidies away the select.js a node left when it stops listing a folder, and keeps what it said', async () => {
      await writeProject(dir, graphWith('directory'));
      expect(existsSync(join(dir, 'nodes', 'source', 'select.js'))).toBe(true);
      await writeProject(dir, graphWith('text'));
      expect(existsSync(join(dir, 'nodes', 'source', 'select.js'))).toBe(false);
      // Not lost: a node switched back to directory mode still has its selector.
      const saved = JSON.parse(await readFile(join(dir, 'graph.json'), 'utf8'));
      expect(saved.nodes[0].config.selector_code).toBe(starter);
    });

    it('reads the selector a save from before kept in its files, and keeps it in the graph from then on', async () => {
      // Before, a save took the selector out of the graph and into its files
      // in every mode. A node that had listed a folder, then been switched to
      // text, held what somebody wrote for it only there.
      const own = 'function run(inputs) {\n  return { files: (inputs.files ?? []).filter((f) => f.endsWith(".md")) };\n}';
      const folder = join(dir, 'nodes', 'source');
      await mkdir(folder, { recursive: true });
      await writeFile(join(dir, 'graph.json'), JSON.stringify({
        metadata: { name: 'old' },
        nodes: [{ id: 'source', node_type: 'input', label: 'Source', position: { x: 0, y: 0 }, inputs: [], outputs: [], config: { input_mode: 'text', value: 'data' } }],
        edges: [],
      }));
      // As a save wrote them: the text, and a newline to end the file.
      await writeFile(join(folder, 'select.js'), `${own}\n`);
      await writeFile(join(folder, 'task.md'), 'Only the notes.\n');

      const graph = await readProject(dir);
      expect(graph.nodes[0].config.selector_code).toBe(own);
      expect(graph.nodes[0].config.selector_prompt).toBe('Only the notes.');

      await writeProject(dir, graph);
      expect(existsSync(join(folder, 'select.js'))).toBe(false);
      const saved = JSON.parse(await readFile(join(dir, 'graph.json'), 'utf8'));
      expect(saved.nodes[0].config).toMatchObject({ selector_code: own, selector_prompt: 'Only the notes.' });
    });

    it('reads the starter every input used to be given as no selector, and writes no select.js for it', async () => {
      // The editor gave every new input this selector, which hands on every
      // file -- as an empty one does. Read as somebody's, it kept a select.js
      // in the folder and counted as written, so the sweep never wrote one.
      const earlier = 'function run(inputs) {\n  // inputs.files is the full list of file paths in the directory\n  return { files: inputs.files ?? [] };\n}\n';
      const folder = join(dir, 'nodes', 'source');
      await mkdir(folder, { recursive: true });
      await writeFile(join(dir, 'graph.json'), JSON.stringify({
        metadata: { name: 'old' },
        nodes: [{ id: 'source', node_type: 'input', label: 'Source', position: { x: 0, y: 0 }, inputs: [], outputs: [], config: { input_mode: 'directory', value: 'data' } }],
        edges: [],
      }));
      await writeFile(join(folder, 'select.js'), earlier);

      const graph = await readProject(dir);
      expect(graph.nodes[0].config.selector_code).toBeUndefined();

      // A graph still holding it inline, as a plain graph file of before does.
      graph.nodes[0].config.selector_code = earlier;
      await writeProject(dir, graph);
      expect(existsSync(join(folder, 'select.js'))).toBe(false);
    });
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
