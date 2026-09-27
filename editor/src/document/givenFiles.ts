// The files a code or an ai node is given to write its definitions from.
//
// ✨ Input writes input.js from real files -- examples of what arrives, a spec
// -- and ✨ Output may be given some too: the node keeps their paths in
// `input_files` and `output_files`. A drop on the node adds one, and so do 📂
// and ⟳ in its panel. Kept apart from what reads the graph around a node
// (`authoring/exampleFile.ts`), so an element's builder can add a file without
// importing the registry it is part of.

import type { GraphNode } from '@/graph';

/** Which ✨'s files: ✨ Input's or ✨ Output's. */
type Side = 'input' | 'output';

const KEY = { input: 'input_files', output: 'output_files' } as const;

/** The files *node* was given for *side*'s ✨, as it holds them. */
export function filesOf(node: GraphNode, side: Side): string[] {
  const held = node.config[KEY[side]];
  return Array.isArray(held) ? held.filter((path): path is string => typeof path === 'string' && !!path.trim()) : [];
}

/** *node* given one more file for *side*'s ✨ -- once: a file given twice is still one, and *node* itself. */
export function withFile(node: GraphNode, side: Side, path: string): GraphNode {
  const files = filesOf(node, side);
  return files.includes(path) ? node : { ...node, config: { ...node.config, [KEY[side]]: [...files, path] } };
}
