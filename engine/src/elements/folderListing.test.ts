import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extensionFilter, listFolder } from './folderListing.ts';
import { nodeRuntime } from '../host/node.ts';
import { registry } from './registry.ts';
import { parseWidget } from './nodes/gui/GuiNodeRunner.ts';
import type { GraphNode } from '../graph.ts';

/**
 * A folder listing is the folder, its file types and its subfolders -- the
 * same for an input node and a file-picker block. Keeping only some of the
 * files is a code node after it.
 */
let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-graph-listing-'));
  await mkdir(join(dir, 'more'));
  for (const name of ['a.CSV', 'b.csv', 'c.txt', join('more', 'd.csv')]) await writeFile(join(dir, name), 'x');
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const runtime = nodeRuntime();
const names = (files: string[]) => files.map((file) => file.slice(dir.length + 1).split('\\').join('/'));

describe('a folder listing', () => {
  it('reads its file types in any case, with or without the dot', () => {
    expect(extensionFilter(' .CSV, txt ,, Md')).toEqual(['.csv', '.txt', '.md']);
    expect(extensionFilter('')).toEqual([]);
  });

  it('keeps the file types it names whatever their case -- "CSV" found nothing', async () => {
    expect(names(await listFolder(dir, { recursive: false, extensions: 'CSV' }, runtime))).toEqual(['a.CSV', 'b.csv']);
    expect(names(await listFolder(dir, { recursive: false, extensions: '' }, runtime))).toEqual(['a.CSV', 'b.csv', 'c.txt']);
  });

  it('looks into subfolders only when told to', async () => {
    expect(names(await listFolder(dir, { recursive: true, extensions: '.csv' }, runtime))).toEqual(['a.CSV', 'b.csv', 'more/d.csv']);
  });

  it('is the same for an input node and a file-picker block, and no old selector narrows either', async () => {
    const selector_code = 'function run() { return { files: [] }; }';
    const node = { id: 'n', node_type: 'input', config: { input_mode: 'directory', value: dir, extensions: 'csv', selector_code, select_all_files: false } } as unknown as GraphNode;
    const block = parseWidget({ id: 'pick', kind: 'input_picker', mode: 'directory', value: dir, extensions: 'csv', selector_code, select_all_files: false });
    const fromNode = await registry.node('input')!.execute(node, {}, runtime);
    const fromBlock = await registry.widget('input_picker')!.execute(block, {}, runtime);
    expect(names(fromNode.files as string[])).toEqual(['a.CSV', 'b.csv']);
    expect(fromNode.count).toBe(2);
    expect(fromBlock.pick_out).toEqual(fromNode.files);
  });
});
