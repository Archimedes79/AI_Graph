// The editor's view of the machine's files: finding projects and dropped
// files, and handing a node's file to the editor the person works in.
//
// Editor-only, on purpose: none of it belongs in a bundle, which is why this
// folder is skipped by the bundle walk along with every other `editor/`.
// Browsing used to live here too and does not any more — a deployed tool needs
// a file picker that can be navigated, so it moved to `host/browse.ts`, which
// a bundle carries.

import { existsSync, type Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { platform } from 'node:os';

import { isProjectFolder } from '../../project/folder.ts';
// One "there is nothing there" for everything on this side of the wire, so a
// route that turns it into a 404 needs one check rather than a list.
import { NotFound } from '../../errors.ts';

/** Folders a search passes over: dependencies and build output -- and every name that begins with a dot. */
const SKIPPED = new Set(['node_modules', 'dist', 'build']);

/** How many levels of folders below the one it starts in a search looks into. */
const FOLDERS_BELOW = 3;

/**
 * What is in *root* and the folders below it, as far down as `fileSearch`
 * says: each entry is handed to *take*, and the paths it takes are the answer.
 * A folder it takes is not looked into.
 *
 * For what is dropped onto the editor: a browser hands a page the name of a
 * file or folder, never where it is, and what someone drops is almost always
 * in the folder the editor was started in.
 */
async function walkUnder(root: string, take: (path: string, entry: Dirent) => boolean | Promise<boolean>): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, below: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || (entry.isDirectory() && SKIPPED.has(entry.name))) continue;
      const path = join(directory, entry.name);
      if (await take(path, entry)) found.push(path);
      else if (entry.isDirectory() && below < FOLDERS_BELOW) await walk(path, below + 1);
    }
  };
  await walk(root, 0);
  return found;
}

/** Project folders named *name* under *root* (`walkUnder`): for a folder dropped onto the editor. */
export async function findProjects(name: string, root = process.cwd()): Promise<string[]> {
  if (basename(root) === name && isProjectFolder(root)) return [root];
  return walkUnder(root, (path, entry) => entry.isDirectory() && entry.name === name && isProjectFolder(path));
}

/**
 * Files named *name*, of *size* bytes, under *root* (`walkUnder`): for a file
 * dropped onto a node, or onto its example -- a node that reads the file at a
 * path needs the path. The size tells two of one name apart.
 */
export async function findFiles(name: string, size: number, root = process.cwd()): Promise<string[]> {
  return walkUnder(root, async (path, entry) => !entry.isDirectory() && entry.name === name
    && (await stat(path).catch(() => null))?.size === size);
}

/**
 * Where a search for what was dropped looks (`walkUnder`), in words: what a
 * drop that found nothing says. It said "under the folder the editor was
 * started in" of a search that goes three folders down and passes some over.
 */
export function fileSearch(root = process.cwd()): string {
  return `${root} and ${FOLDERS_BELOW} levels of folders below it, leaving out ${[...SKIPPED].join(', ')} and every name that begins with a dot`;
}

// ---------------------------------------------------------------------------
// Handing a node's file to the person's own editor
// ---------------------------------------------------------------------------

export class NotOpenable extends Error {}

/**
 * What a project keeps writing in, and the text an example reads: nothing a
 * system would run when it is "opened". Nothing else is ever handed to another program.
 */
const OPENABLE = new Set(['.js', '.md', '.json', '.txt', '.csv', '.tsv', '.jsonl', '.xml', '.yaml', '.yml', '.log']);

/**
 * Open one of a graph's node files in the editor the person actually works in.
 *
 * The box in the node dialog is fine for an edit; an afternoon's work wants a
 * language server, a debugger's view, a second monitor. The file is already
 * there -- "keep this in a file beside the graph" -- so the missing piece was
 * only the way to it.
 *
 * Narrow on purpose, because this starts a program on the machine: the path
 * must be an existing text file (`OPENABLE`) inside the project's `nodes/` folder,
 * so a page cannot use it to launch an arbitrary file. VS Code is tried first, by
 * its `code` command, since that is where a `.js` with a JSDoc header is most
 * useful; anything else falls to whatever the system opens that file type with.
 */
export async function openExternal(nodesDir: string, relative: string): Promise<{ path: string; with: string }> {
  const root = resolve(nodesDir);
  const path = resolve(root, relative);
  if (!path.startsWith(root + sep)) throw new NotOpenable('That file is not one of this project\'s node files.');
  if (!OPENABLE.has(extname(path).toLowerCase())) {
    throw new NotOpenable(`Only a node's text can be opened this way: a ${[...OPENABLE].join(', ')} file.`);
  }
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
