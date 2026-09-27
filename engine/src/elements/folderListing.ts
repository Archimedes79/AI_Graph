// Listing a folder: the input node's directory mode and the file-picker
// block's, one behaviour at two levels, implemented once.
//
// A listing is the folder, its file types and whether it looks into
// subfolders -- nothing else. Keeping only some of the files is a code node
// wired in after the listing, like any other choice a graph makes.
import { type Runtime } from './Runtime.ts';

/**
 * `.md, TXT` -> ['.md', '.txt']: the file types a listing keeps, in lower case
 * because a file's own suffix is compared in lower case. Empty means every file.
 */
export function extensionFilter(raw: string): string[] {
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`));
}

/** The files in the folder *path*, sorted: its subfolders' too when *recursive*, only the file types *extensions* names. */
export function listFolder(
  path: string,
  settings: { recursive: boolean; extensions: string },
  runtime: Runtime,
): Promise<string[]> {
  const extensions = extensionFilter(settings.extensions);
  return runtime.files.list(path, {
    recursive: settings.recursive,
    extensions: extensions.length ? extensions : undefined,
  });
}
