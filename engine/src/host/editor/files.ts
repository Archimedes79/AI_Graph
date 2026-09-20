// The editor's view of the machine's files: attachments, finding projects, and
// a guess at what a file holds.
//
// Editor-only, on purpose: none of it belongs in a bundle, which is why this
// folder is skipped by the bundle walk along with every other `editor/`.
// Browsing used to live here too and does not any more — a deployed tool needs
// a file picker that can be navigated, so it moved to `host/browse.ts`, which
// a bundle carries.

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { platform } from 'node:os';

import { isProjectFolder } from '../../project/folder.ts';
// One "there is nothing there" for everything on this side of the wire, so a
// route that turns it into a 404 needs one check rather than a list.
export { NotFound } from '../browse.ts';
import { NotFound } from '../browse.ts';

/**
 * Project folders named *name* under *root*, a few levels down.
 *
 * For a folder dropped onto the editor: a browser hands over its name and not
 * where it is, and the projects someone drops are almost always in the folder
 * the editor was started in. Dependencies, build output and dot-folders are
 * not looked into.
 */
export async function findProjects(name: string, root = process.cwd(), depth = 4): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, level: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.name === name && isProjectFolder(path)) found.push(path);
      else if (level < depth) await walk(path, level + 1);
    }
  };
  if (basename(root) === name && isProjectFolder(root)) return [root];
  await walk(root, 1);
  return found;
}

const SKIPPED = new Set(['node_modules', 'dist', 'build']);

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

// ---------------------------------------------------------------------------
// Handing a node's file to the person's own editor
// ---------------------------------------------------------------------------

export class NotOpenable extends Error {}

/** What a project keeps writing in. Nothing else is ever handed to another program. */
const OPENABLE = new Set(['.js', '.md', '.json']);

/**
 * Open one of a graph's node files in the editor the person actually works in.
 *
 * The box in the node dialog is fine for an edit; an afternoon's work wants a
 * language server, a debugger's view, a second monitor. The file is already
 * there -- "keep this in a file beside the graph" -- so the missing piece was
 * only the way to it.
 *
 * Narrow on purpose, because this starts a program on the machine: the path
 * must be an existing `.js`/`.md`/`.json` inside the project's `nodes/` folder, so a
 * page cannot use it to launch an arbitrary file. VS Code is tried first, by
 * its `code` command, since that is where a `.js` with a JSDoc header is most
 * useful; anything else falls to whatever the system opens that file type with.
 */
export async function openExternal(nodesDir: string, relative: string): Promise<{ path: string; with: string }> {
  const root = resolve(nodesDir);
  const path = resolve(root, relative);
  if (!path.startsWith(root + sep)) throw new NotOpenable('That file is not one of this project\'s node files.');
  if (!OPENABLE.has(extname(path).toLowerCase())) throw new NotOpenable('Only a node\'s .js, .md or .json file can be opened.');
  if (!existsSync(path)) throw new NotFound(`${path} does not exist yet. Save the graph first: saving is what writes it.`);

  const { spawn } = await import('node:child_process');
  const start = (command: string, args: string[], shell: boolean): Promise<boolean> => new Promise((done) => {
    try {
      const child = spawn(command, args, { detached: !shell, stdio: 'ignore', shell, windowsHide: true });
      child.on('error', () => done(false));
      if (shell) {
        // Through a shell, "started" only means the shell did. Whether the
        // command exists is its exit code: `code` returns 0 as soon as it has
        // handed the file over, and a shell that cannot find it returns 1.
        const patience = setTimeout(() => done(true), 5000);
        child.on('exit', (code) => { clearTimeout(patience); done(code === 0); });
        return;
      }
      child.on('spawn', () => { child.unref(); done(true); });
    } catch {
      done(false);
    }
  });

  const windows = platform() === 'win32';
  // `code` is a .cmd shim on Windows, which only a shell can start; quoted, because a path may hold spaces.
  if (await start(windows ? `code -g "${path}"` : 'code', windows ? [] : ['-g', path], windows)) {
    return { path, with: 'VS Code' };
  }
  const opener = windows ? ['cmd', ['/c', 'start', '', path]] as const
    : platform() === 'darwin' ? ['open', [path]] as const : ['xdg-open', [path]] as const;
  if (await start(opener[0], [...opener[1]], false)) return { path, with: 'the system default' };
  throw new NotOpenable(`Nothing on this machine could open ${path}.`);
}
