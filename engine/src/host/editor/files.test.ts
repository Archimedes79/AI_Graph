import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findFiles, findProjects } from './files.ts';

/**
 * What the editor's project search and its "open in my editor" get from the machine.
 *
 * Browsing is not here: it is the same picker a deployed tool serves, and it
 * is tested in `host/browse.test.ts` beside the code.
 */

async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'editor-files-'));
  await mkdir(join(dir, 'sub'));
  await writeFile(join(dir, 'b.txt'), 'hello');
  await writeFile(join(dir, 'a.md'), '# hi');
  await writeFile(join(dir, 'blob.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
  return dir;
}

describe('openExternal', () => {
  // Only the refusals are tested: the acceptance starts a program on whatever
  // machine runs the suite, and a test that opens an editor window is one
  // nobody keeps switched on.
  it('refuses a path outside the graph\'s own node folder', async () => {
    const { openExternal, NotOpenable } = await import('./files.ts');
    const dir = await sandbox();
    await expect(openExternal(join(dir, 'sub'), '../b.txt')).rejects.toBeInstanceOf(NotOpenable);
  });

  it('refuses anything that is not a node\'s .js or .md', async () => {
    const { openExternal, NotOpenable } = await import('./files.ts');
    const dir = await sandbox();
    await expect(openExternal(dir, 'b.txt')).rejects.toBeInstanceOf(NotOpenable);
    await expect(openExternal(dir, 'blob.bin')).rejects.toBeInstanceOf(NotOpenable);
  });

  it('says the graph must be saved when the file is not there yet', async () => {
    const { openExternal } = await import('./files.ts');
    const { NotFound } = await import('../../errors.ts');
    const dir = await sandbox();
    await expect(openExternal(dir, 'Analyse.js')).rejects.toBeInstanceOf(NotFound);
  });
});

describe('findProjects', () => {
  it('finds the project folders of a dropped folder\'s name, and nothing in dependencies or build output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-graph-find-'));
    for (const folder of ['examples/chat', 'work/chat', 'node_modules/pkg/chat', 'examples/data', 'notes/chat']) {
      await mkdir(join(root, folder), { recursive: true });
    }
    for (const project of ['examples/chat', 'work/chat', 'node_modules/pkg/chat']) {
      await writeFile(join(root, project, 'flow.json'), '{"nodes": {}, "wires": []}');
    }
    expect((await findProjects('chat', root)).map((path) => path.slice(root.length + 1).split(/[\\/]/).join('/')).sort())
      .toEqual(['examples/chat', 'work/chat']);
    expect(await findProjects('data', root)).toEqual([]);
    expect(await findProjects('chat', join(root, 'examples', 'chat'))).toEqual([join(root, 'examples', 'chat')]);
  });
});

describe('findFiles', () => {
  it('finds a dropped file by its name and size, and nothing in dependencies, dot-folders or build output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-graph-find-file-'));
    for (const folder of ['examples/data', 'other', 'node_modules/pkg', '.cache']) await mkdir(join(root, folder), { recursive: true });
    await writeFile(join(root, 'examples/data/people.csv'), 'name\nAnna\n');
    await writeFile(join(root, 'other/people.csv'), 'name\nAnna\nBen\n');
    await writeFile(join(root, 'node_modules/pkg/people.csv'), 'name\nAnna\n');
    await writeFile(join(root, '.cache/people.csv'), 'name\nAnna\n');
    const found = async (size: number) => (await findFiles('people.csv', size, root)).map((path) => path.slice(root.length + 1).split(/[\\/]/).join('/'));
    expect(await found(10)).toEqual(['examples/data/people.csv']);
    expect(await found(14)).toEqual(['other/people.csv']);
    expect(await found(3)).toEqual([]);
  });
});
