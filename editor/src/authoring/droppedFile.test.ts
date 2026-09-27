import { beforeEach, describe, expect, it } from 'vitest';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import { useGraphStore } from '@/store/graphStore';
import { dropExample, droppedPath, uriPath, type Dropped } from './droppedFile';
import { fileValue } from './readAsRun';

/**
 * A file dropped onto a code or an ai node -- or onto the files line under its
 * ✨ Input -- is one more file its input definition is written from; dropped
 * onto a data node, it is what the node holds.
 */

const dropped = (name: string, text: string, uri?: string): Dropped => ({ name, size: text.length, text: async () => text, ...(uri ? { uri } : {}) });
/** The engine's search, finding *paths*, and saying where it looked as `fileSearch` says it. */
const found = (...paths: string[]) => async () => ({ paths, searched: 'D:\\work and 3 levels of folders below it, leaving out node_modules, dist, build and every name that begins with a dot' });
const one = (path: string) => found(path);
const as = async (path: string) => path;

describe('where a dropped file is', () => {
  it('is the path its drop named, where it named one', async () => {
    expect(uriPath('file:///D:/work/data/people%20list.csv')).toBe('D:/work/data/people list.csv');
    expect(uriPath('file:///home/me/a.csv')).toBe('/home/me/a.csv');
    expect(await droppedPath(dropped('a.csv', 'x', 'file:///home/me/a.csv'), found())).toBe('/home/me/a.csv');
  });

  it('keeps the server of a file on a share: without it, the path named a folder on this machine', () => {
    expect(uriPath('file://fileserver/share/people.csv')).toBe('//fileserver/share/people.csv');
    expect(uriPath('file://fileserver/team%20data/a.csv')).toBe('//fileserver/team data/a.csv');
    // "localhost" is this machine, as a URI says it.
    expect(uriPath('file://localhost/D:/work/a.csv')).toBe('D:/work/a.csv');
  });

  it('is otherwise the one file of its name and size under the editor\'s folder -- and none, or several, is said', async () => {
    expect(await droppedPath(dropped('a.csv', 'x'), one('D:/work/a.csv'))).toBe('D:/work/a.csv');
    await expect(droppedPath(dropped('a.csv', 'x'), found())).rejects.toThrow(/choose it with 📂/);
    await expect(droppedPath(dropped('a.csv', 'x'), found('a', 'b'))).rejects.toThrow(/2 files called “a.csv”/);
  });

  it('says where it was looked for, when it was found nowhere: "under the folder" was said of a search three folders deep', async () => {
    await expect(droppedPath(dropped('four.csv', 'x'), found())).rejects.toThrow(
      'A browser does not say where a dropped file is, and no “four.csv” of that size is in D:\\work and 3 levels of folders below it, '
      + 'leaving out node_modules, dist, build and every name that begins with a dot: choose it with 📂 Add a file….',
    );
  });
});

describe('what a file puts into the example, dropped or picked', () => {
  const nowhere = async (): Promise<string> => { throw new Error('asked where a file is whose text is wanted'); };
  const unread = async (): Promise<string> => { throw new Error('read a file whose path is wanted'); };

  it('is its path where the node reads the file, and what it says -- parsed when JSON -- where it does not', async () => {
    const file = dropped('a.csv', 'name\nAnna');
    expect(await fileValue(true, () => droppedPath(file, one('D:/work/a.csv')), unread, as)).toBe('D:/work/a.csv');
    expect(await fileValue(false, nowhere, file.text, as)).toBe('name\nAnna');
    expect(await fileValue(false, nowhere, dropped('a.json', '{"rows": [1, 2]}').text, as)).toEqual({ rows: [1, 2] });
  });
});

describe('a file dropped onto a node on the canvas', () => {
  const store = () => useGraphStore.getState();
  const stored = (id: string) => store().rfNodes.find((item) => item.id === id)!.data.graphNode as GraphNode;
  beforeEach(() => {
    store().loadGraph({
      metadata: { name: 'Drop', description: '', gui_scheme: 'night' },
      nodes: [NODE_KINDS.code.create('reader'), NODE_KINDS.ai.create('asker'), NODE_KINDS.data.create('memory')],
      edges: [],
    });
  });

  it('is one more file ✨ Input writes from -- a file given twice is still one -- one undo step, and opens the node\'s dialog', async () => {
    await dropExample('reader', 'path', dropped('people.csv', 'name\nAnna'), one('D:/work/people.csv'), as);
    expect(stored('reader').config.input_files).toEqual(['D:/work/people.csv']);
    expect(store().editingNodeId).toBe('reader');
    await dropExample('reader', 'path', dropped('spec.md', '# Columns'), one('D:/work/spec.md'), as);
    await dropExample('reader', 'path', dropped('people.csv', 'name\nAnna'), one('D:/work/people.csv'), as);
    expect(stored('reader').config.input_files).toEqual(['D:/work/people.csv', 'D:/work/spec.md']);
    store().undo();
    expect(stored('reader').config.input_files).toEqual(['D:/work/people.csv']);
  });

  it('is taken where the element says: its path by a code or an ai node that takes something in, what it says by a data node', () => {
    const takes = (node: GraphNode) => NODE_BUILDERS[node.node_type].dropPort(node);
    expect(takes(stored('reader'))).toBe('path');
    expect(takes(stored('asker'))).toBe('path');
    expect(takes(stored('memory'))).toBe('text');
    expect(takes({ ...stored('reader'), inputs: [] })).toBeUndefined();
    expect(takes(NODE_KINDS.output.create('sink'))).toBeUndefined();
    expect(takes(NODE_KINDS.input.create('source'))).toBeUndefined();
  });

  it('is what a data node holds: what the file says, parsed when it is JSON', async () => {
    await dropExample('memory', 'text', dropped('state.json', '{"count": 3}'));
    expect(stored('memory').config.data_value).toEqual({ count: 3 });
  });
});
