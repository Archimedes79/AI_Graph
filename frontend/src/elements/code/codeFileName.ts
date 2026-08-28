import type { GraphNode } from '../../types/graph';

/**
 * The file name this node's code would get.
 *
 * Only a first suggestion: the backend derives the real name on save (see
 * `node_files.default_file_name`), renames the file when the node's label
 * changes, and resolves collisions -- it is the side that can see the folder.
 * This exists so ticking the checkbox shows a plausible name immediately
 * rather than an empty field.
 */
export function suggestedCodeFileName(node: GraphNode): string {
  const extension = (node.config.language ?? 'python').toLowerCase().startsWith('java') ? '.js' : '.py';
  const base = (node.label || 'node')
    .replace(/[^\w\-. ]/gu, '')
    .trim()
    .replace(/[\s.]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${base || 'node'}${extension}`;
}
