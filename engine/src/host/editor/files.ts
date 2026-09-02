// The editor's view of the machine's files: browsing, attachments, and a guess
// at what a file holds.
//
// Editor-only, and kept apart from the engine's own file service on purpose. A
// deployed tool lists files for a picker; the editor also needs directories to
// walk into, drives to jump to, and a place to keep the example files people
// attach to a node. None of that belongs in a bundle, which is why this folder
// is skipped by the bundle walk along with every other `editor/`.

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface BrowseEntry { name: string; path: string; is_dir: boolean }
export interface BrowsePage { path: string; parent: string | null; entries: BrowseEntry[]; roots: string[] }

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
 * will run on. An empty path starts at home; an unreadable child is skipped
 * rather than failing the page, since one denied entry should not make a
 * directory unbrowsable.
 */
export async function browse(path: string, extensions: string[] = []): Promise<BrowsePage> {
  let root = path ? resolve(path.replace(/^~(?=$|[\\/])/, homedir())) : homedir();
  const info = await stat(root).catch(() => null);
  if (!info) throw new NotFound(`Directory not found: ${root}`);
  if (!info.isDirectory()) root = dirname(root);

  const directories: BrowseEntry[] = [];
  const files: BrowseEntry[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    let isDir: boolean;
    try {
      isDir = entry.isDirectory();
    } catch {
      continue;
    }
    if (isDir) directories.push({ name: entry.name, path: full, is_dir: true });
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

/**
 * Where the example files people attach to a node are kept.
 *
 * Beside the project, under `data/attachments`, so a graph and the samples it
 * was generated against travel together; overridable for a packaged editor,
 * whose own directory tree is a temp dir that vanishes on exit.
 */
export function attachmentsDir(root = process.cwd()): string {
  return process.env.ATTACHMENTS_DIR || join(root, 'data', 'attachments');
}

/** Keep an uploaded file under a name nothing else will collide with, and say where. */
export async function saveAttachment(name: string, content: Buffer, dir = attachmentsDir()): Promise<string> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${randomBytes(16).toString('hex')}_${basename(name) || 'attachment'}`);
  await writeFile(target, content);
  return target;
}

/** Remove one, refusing to touch anything outside the attachments folder. */
export async function deleteAttachment(path: string, dir = attachmentsDir()): Promise<void> {
  const target = resolve(path);
  if (!target.startsWith(resolve(dir) + sep)) {
    throw new Error('Refusing to delete a path outside the attachments directory');
  }
  await unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

const KNOWN: Record<string, string> = {
  '.csv': 'csv',
  '.json': 'json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * A guess at a port's `format` for this file: a specific name when the
 * extension says so, otherwise `text` or `binary` by whether it decodes.
 */
export async function detectFormat(path: string): Promise<string> {
  if (!existsSync(path)) throw new NotFound(`File not found: ${path}`);
  const known = KNOWN[extname(path).toLowerCase()];
  if (known) return known;
  const head = (await readFile(path)).subarray(0, 8192);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return 'text';
  } catch {
    return 'binary';
  }
}
