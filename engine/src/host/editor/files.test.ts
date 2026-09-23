import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteAttachment, detectFormat, findProjects, saveAttachment } from './files.ts';

/**
 * What the editor's attachment box and project search get from the machine.
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


describe('attachments', () => {
  it('keeps a file under a unique name and can remove it again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'attachments-'));
    const path = await saveAttachment('sample.csv', Buffer.from('a,b'), dir);
    expect(path.endsWith('_sample.csv')).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('a,b');
    await deleteAttachment(path, dir);
    expect(existsSync(path)).toBe(false);
  });

  it('refuses to delete outside its own folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'attachments-'));
    const elsewhere = join(await mkdtemp(join(tmpdir(), 'elsewhere-')), 'x');
    await writeFile(elsewhere, 'keep me');
    await expect(deleteAttachment(elsewhere, dir)).rejects.toThrow(/outside/);
    expect(existsSync(elsewhere)).toBe(true);
  });
});

describe('what a file holds', () => {
  it('names the format by extension, and text or binary by content', async () => {
    const dir = await sandbox();
    expect(await detectFormat(join(dir, 'a.md'))).toBe('text');
    expect(await detectFormat(join(dir, 'blob.bin'))).toBe('binary');
    await writeFile(join(dir, 'rows.csv'), 'a,b');
    expect(await detectFormat(join(dir, 'rows.csv'))).toBe('csv');
  });
});

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
      await writeFile(join(root, project, 'graph.json'), '{"nodes": [], "edges": []}');
    }
    expect((await findProjects('chat', root)).map((path) => path.slice(root.length + 1).split(/[\\/]/).join('/')).sort())
      .toEqual(['examples/chat', 'work/chat']);
    expect(await findProjects('data', root)).toEqual([]);
    expect(await findProjects('chat', join(root, 'examples', 'chat'))).toEqual([join(root, 'examples', 'chat')]);
  });
});
