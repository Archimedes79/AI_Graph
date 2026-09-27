import { describe, it, expect } from 'vitest';
import { OutputNodeRunner } from './OutputNodeRunner.ts';
import type { Runtime } from '../../Runtime.ts';
import type { GraphNode } from '../../../graph.ts';

/**
 * Where a result goes when it is written: one file, or a folder with a file
 * per value.
 *
 * "Write to a directory (one file per value)" was offered in the panel, asked
 * for a folder when the run started, and was described to the model that
 * designs graphs -- and then wrote nothing, with the run reporting success.
 * An option that does nothing is worse than no option, so it is held here to
 * doing what it says.
 */

function outputNode(config: Record<string, unknown>): GraphNode {
  return {
    id: 'out', node_type: 'output', label: 'Out', description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
  };
}

/** A runtime whose files are a map: what was written, and where. */
function recording() {
  const written = new Map<string, string>();
  const runtime: Runtime = {
    files: {
      resolve: (path) => `/resolved${path}`,
      exists: async () => true,
      read: async () => '',
      write: async (path, content) => { written.set(path, content); },
      list: async () => [],
    },
    code: { run: async (_body, inputs) => inputs },
    ai: { complete: async () => '' },
  };
  return { runtime, written };
}

const element = new OutputNodeRunner();

describe('an output node writing to a folder', () => {
  it('writes each value to a file of its own, and says which', async () => {
    const { runtime, written } = recording();
    const result = await element.execute(
      outputNode({ write_mode: 'directory', value: '/tmp/out' }),
      { summary: 'alpha', table: { rows: 2 } },
      runtime,
    );
    expect([...written]).toEqual([
      ['/tmp/out/summary.txt', 'alpha'],
      ['/tmp/out/table.json', JSON.stringify({ rows: 2 }, null, 2)],
    ]);
    expect(result.written_paths).toEqual(['/tmp/out/summary.txt', '/tmp/out/table.json']);
    // Still a passthrough: the run's result says what arrived.
    expect(result).toMatchObject({ summary: 'alpha', table: { rows: 2 } });
  });

  it('writes each item of a list as a value of its own, numbered by its place', async () => {
    // What a node run once per item hands on. A failed item is a null: it
    // writes nothing, and the files after it keep their numbers.
    const { runtime, written } = recording();
    const items = Array.from({ length: 10 }, (_, index) => (index === 1 ? null : `item ${index + 1}`));
    await element.execute(outputNode({ write_mode: 'directory', value: '/tmp/out/' }), { value: items }, runtime);
    expect([...written.keys()]).toEqual([
      '/tmp/out/value_01.txt', '/tmp/out/value_03.txt', '/tmp/out/value_04.txt', '/tmp/out/value_05.txt',
      '/tmp/out/value_06.txt', '/tmp/out/value_07.txt', '/tmp/out/value_08.txt', '/tmp/out/value_09.txt',
      '/tmp/out/value_10.txt',
    ]);
    expect(written.get('/tmp/out/value_10.txt')).toBe('item 10');
  });

  it('writes into the folder a wired path names, and never writes the path itself', async () => {
    const { runtime, written } = recording();
    const result = await element.execute(
      outputNode({ write_mode: 'directory', value: '/configured' }),
      { value: 'alpha', path: '/wired' },
      runtime,
    );
    expect([...written.keys()]).toEqual(['/resolved/wired/value.txt']);
    expect(result).not.toHaveProperty('path');
  });

  it('leaves this run\'s values in the folder and no earlier run\'s, and nothing else of the folder\'s goes', async () => {
    // Run 2 wrote value_1 and value_3 beside run 1's value_01..value_10, and
    // with the same count a failed item's slot kept the file of the run before.
    const files = new Map<string, string>([['/tmp/out/notes.md', 'mine'], ['/tmp/out/value_x.txt', 'mine too']]);
    const runtime: Runtime = {
      ...recording().runtime,
      files: {
        resolve: (path) => path,
        exists: async (path) => files.has(path),
        read: async (path) => files.get(path) ?? '',
        write: async (path, content) => { files.set(path, content); },
        list: async (folder) => [...files.keys()].filter((path) => path.startsWith(`${folder}/`)).sort(),
        remove: async (path) => { files.delete(path); },
      },
    };
    const node = outputNode({ write_mode: 'directory', value: '/tmp/out' });
    await element.execute(node, { value: Array.from({ length: 10 }, (_, index) => `old ${index + 1}`) }, runtime);
    expect(files.size).toBe(12);

    await element.execute(node, { value: ['new 1', null, 'new 3'] }, runtime);
    expect([...files.keys()].sort()).toEqual(['/tmp/out/notes.md', '/tmp/out/value_1.txt', '/tmp/out/value_3.txt', '/tmp/out/value_x.txt']);

    // The same count again, the second failing now: its slot is empty, not last run's.
    await element.execute(node, { value: ['newer 1', 'newer 2', 'newer 3'] }, runtime);
    await element.execute(node, { value: ['newest 1', null, 'newest 3'] }, runtime);
    expect(files.has('/tmp/out/value_2.txt')).toBe(false);
    expect(files.get('/tmp/out/value_3.txt')).toBe('newest 3');
  });

  it('keeps a Windows folder in its own separator', async () => {
    const { runtime, written } = recording();
    await element.execute(outputNode({ write_mode: 'directory', value: 'C:\\results' }), { value: 'alpha' }, runtime);
    expect([...written.keys()]).toEqual(['C:\\results\\value.txt']);
  });

  it('is said to write, in what runs', () => {
    expect(element.whatRuns(outputNode({ write_mode: 'directory' })).does).toContain('written_paths');
  });
});

describe('an output node writing to one file', () => {
  it('writes what arrives there, as before', async () => {
    const { runtime, written } = recording();
    const result = await element.execute(outputNode({ write_mode: 'file', value: '/tmp/out.txt' }), { value: 'alpha' }, runtime);
    expect([...written]).toEqual([['/tmp/out.txt', 'alpha']]);
    expect(result.written_path).toBe('/tmp/out.txt');
  });

  it('writes nothing when it is not asked to', async () => {
    for (const write_mode of ['none', 'window', undefined]) {
      const { runtime, written } = recording();
      await element.execute(outputNode({ write_mode, value: '/tmp/out' }), { value: 'alpha' }, runtime);
      expect(written.size).toBe(0);
    }
  });
});
