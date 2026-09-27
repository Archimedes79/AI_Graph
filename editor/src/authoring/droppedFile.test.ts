import { beforeEach, describe, expect, it } from 'vitest';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import { useGraphStore } from '@/store/graphStore';
import { readPair } from './examplePair';
import { dropExample, droppedPath, uriPath, type Dropped } from './droppedFile';
import { fileValue } from './readAsRun';

/**
 * A file dropped onto a node, or onto step 1's example field, is the example:
 * its path on an input that reads the file, otherwise what it says.
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
      + 'leaving out node_modules, dist, build and every name that begins with a dot: choose it with 📂 From a file….',
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
    const reader = NODE_KINDS.code.create('reader');
    reader.inputs = [{ ...reader.inputs[0], id: 'csv', name: 'csv', data_type: 'file_path' }];
    store().loadGraph({
      metadata: { name: 'Drop', description: '', gui_scheme: 'night' },
      nodes: [reader, NODE_KINDS.code.create('shout'), NODE_KINDS.data.create('memory')],
      edges: [],
    });
  });

  it('is the example on its one input, one undo step, and opens the node\'s dialog to try it', async () => {
    await dropExample('reader', 'csv', dropped('people.csv', 'name\nAnna'), one('D:/work/people.csv'), as);
    expect(readPair(stored('reader').config.examples).input).toEqual({ csv: 'D:/work/people.csv' });
    expect(store().editingNodeId).toBe('reader');
    store().undo();
    expect(stored('reader').config.examples ?? '').toBe('');
  });

  it('is taken where the element says: the one input of a node built in the four steps, and a data node', () => {
    const takes = (node: GraphNode) => NODE_BUILDERS[node.node_type].dropPort(node);
    expect(takes(stored('reader'))).toBe('csv');
    expect(takes(stored('memory'))).toBe('input');
    const two = NODE_KINDS.code.create('two');
    two.inputs = [...two.inputs, { ...two.inputs[0], id: 'more', name: 'more' }];
    expect(takes(two)).toBeUndefined();
    expect(takes(NODE_KINDS.output.create('sink'))).toBeUndefined();
    expect(takes(NODE_KINDS.input.create('source'))).toBeUndefined();
  });

  it('puts what the file says where the node does not read it, and is what a data node holds', async () => {
    await dropExample('shout', 'input', dropped('note.txt', 'hello'));
    expect(readPair(stored('shout').config.examples).input).toEqual({ input: 'hello' });
    await dropExample('memory', 'input', dropped('state.json', '{"count": 3}'));
    expect(stored('memory').config.data_value).toEqual({ count: 3 });
  });
});
