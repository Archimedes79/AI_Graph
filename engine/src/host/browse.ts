// Walking the machine's files, for a picker.
//
// Not editor-only, and that is the point. A deployed tool used to answer the
// same route with the starting directory's files and nothing else -- no
// folders, no parent, no drives -- so whoever was handed the tool could pick a
// file in exactly one directory and had no way out of it. The way up was a
// button the page drew permanently disabled.
//
// The route is loopback-only in both cases (see `serve.ts`): it is the person
// at the keyboard browsing their own machine, who can open a file manager
// beside the tool and do the same thing. Listing a parent directory reveals
// nothing to anyone the file picker was not already for.
//
// What stays behind in `editor/files.ts` is what a recipient has no business
// with: attachments, looking for project folders, guessing a file's format.

import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';

import type { BrowseEntry, BrowsePage } from './api.ts';
import { isProjectFolder } from '../project/folder.ts';

export class NotFound extends Error {}

/** `.md, txt` -> ['.md', '.txt']; empty means "everything". */
export function extensionFilter(raw: string): string[] {
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`));
}

/** Where a browser can jump to: home, plus the drives that exist on Windows and `/` elsewhere. */
export function filesystemRoots(): string[] {
  const roots = [homedir()];
  if (platform() === 'win32') {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const drive = `${letter}:\\`;
      if (existsSync(drive)) roots.push(drive);
    }
  } else {
    roots.push('/');
  }
  return roots;
}

/**
 * One page of a file browser: the directory, its parent, its children.
 *
 * Exists because the engine resolves *real* paths while a browser's file input
 * only ever reveals a name — so a picker has to browse the machine the graph
 * will run on. Hidden entries are left out; an unreadable child is skipped
 * rather than failing the page, since one denied entry should not make a
 * directory unbrowsable.
 *
 * @param path where to look; empty means *home*.
 * @param home where an empty path starts. The editor passes the folder it was
 *   started in, a deployed tool the folder its graph sits in — in both cases
 *   the root of the thing being used, rather than a home directory full of
 *   dot-folders that has nothing to do with it.
 */
export async function browse(path: string, extensions: string[] = [], home = process.cwd()): Promise<BrowsePage> {
  let root = path ? resolve(path.replace(/^~(?=$|[\\/])/, homedir())) : resolve(home);
  const info = await stat(root).catch(() => null);
  if (!info) throw new NotFound(`Directory not found: ${root}`);
  if (!info.isDirectory()) root = dirname(root);

  const directories: BrowseEntry[] = [];
  const files: BrowseEntry[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(root, entry.name);
    let isDir: boolean;
    try {
      isDir = entry.isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      directories.push({ name: entry.name, path: full, is_dir: true, ...(isProjectFolder(full) ? { project: true } : {}) });
    }
    else if (!extensions.length || extensions.includes(extname(entry.name).toLowerCase())) {
      files.push({ name: entry.name, path: full, is_dir: false });
    }
  }
  const byName = (a: BrowseEntry, b: BrowseEntry) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  directories.sort(byName);
  files.sort(byName);

  const parent = dirname(root);
  return {
    path: root,
    parent: parent === root ? null : parent,
    entries: [...directories, ...files],
    roots: filesystemRoots(),
  };
}
