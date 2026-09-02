import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browse, deleteAttachment, detectFormat, extensionFilter, saveAttachment } from './files.ts';

/**
 * What the editor's file picker and attachment box get from the machine.
 *
 * The shapes are the ones `browseDirectory` / `uploadAttachment` in the editor's
 * client already read; this replaces the Python that used to answer them.
 */

async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'editor-files-'));
  await mkdir(join(dir, 'sub'));
  await writeFile(join(dir, 'b.txt'), 'hello');
  await writeFile(join(dir, 'a.md'), '# hi');
  await writeFile(join(dir, 'blob.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
  return dir;
}

describe('browsing', () => {
  it('lists directories first, then files, both by name', async () => {
    const dir = await sandbox();
    const page = await browse(dir);
    expect(page.path).toBe(dir);
    expect(page.entries.map((e) => `${e.is_dir ? 'd' : 'f'}:${e.name}`))
      .toEqual(['d:sub', 'f:a.md', 'f:b.txt', 'f:blob.bin']);
    expect(page.parent).toBeTruthy();
    expect(page.roots.length).toBeGreaterThan(0);
  });

  it('keeps directories when a filter narrows the files', async () => {
    const dir = await sandbox();
    const page = await browse(dir, extensionFilter('md'));
    expect(page.entries.map((e) => e.name)).toEqual(['sub', 'a.md']);
  });

  it('shows the folder of a file, when handed a file', async () => {
    const dir = await sandbox();
    expect((await browse(join(dir, 'a.md'))).path).toBe(dir);
  });

  it('says so when there is nothing there', async () => {
    await expect(browse(join(tmpdir(), 'no-such-dir-anywhere'))).rejects.toThrow(/not found/i);
  });
});

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
