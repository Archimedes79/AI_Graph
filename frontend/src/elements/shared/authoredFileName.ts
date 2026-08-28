/**
 * The file name a node's authored text would get.
 *
 * Only a first suggestion: the backend derives the real name on save (see
 * `node_files.default_file_name`), renames the file when the node's label
 * changes, and resolves collisions -- it is the side that can see the folder.
 * This exists so ticking the checkbox shows a plausible name immediately.
 */
export function suggestedFileName(label: string, extension: string): string {
  const base = (label || 'node')
    .replace(/[^\w\-. ]/gu, '')
    .trim()
    .replace(/[\s.]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${base || 'node'}${extension}`;
}
