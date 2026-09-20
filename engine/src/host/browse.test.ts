import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browse, extensionFilter } from './browse.ts';

/**
 * What a file picker gets from the machine — the editor's and a deployed
 * tool's, which are the same picker.
 *
 * A tool used to answer with the starting directory's files and nothing else,
 * so its user could pick a file in one folder and had no way out of it. The
 * first test below is what that lacked: folders, and a parent to climb to.
 */

async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), 'browse-'));
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

  it('opens where it is told to, not where the process happens to be', async () => {
    // A deployed tool passes the folder its graph sits in. Started by a
    // double-click, `process.cwd()` is whatever the shell felt like, and the
    // picker opening there is the picker opening nowhere useful.
    const dir = await sandbox();
    expect((await browse('', [], dir)).path).toBe(dir);
  });
});
