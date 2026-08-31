import type { GraphNode, NodeType } from '../types/graph';
import { baseNodeConfig } from '../elements/shared/baseNodeConfig';
import { NODE_ELEMENTS } from '../elements/registry';

export function nodeTypeDefaults(nodeType: NodeType, id: string): GraphNode {
  return NODE_ELEMENTS[nodeType].create(id);
}

// Shown on hover in the palette. The widget presets below carried a description
// from the start; the node types -- the ones a newcomer meets first -- did not,
// so "Data Node" had to be guessed from two words and an icon.
export const NODE_TYPE_DESCRIPTIONS: Record<NodeType, string> = {
  input: 'A value from outside the graph: typed text, one file, or a directory listing',
  ai: 'Send a prompt to a local or hosted model and pass on its answer',
  code: 'Run Python or JavaScript — write it yourself or have the AI generate it',
  data: 'Remember a value between runs, so a loop can build on its own last result',
  output: 'Show the result in a window, or write it to a file or directory',
  gui: 'Give the graph its own interface, built from widgets',
};

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  input: 'Input',
  ai: 'AI Node',
  code: 'Code Node',
  data: 'Data Node',
  output: 'Output',
  gui: 'GUI Node',
};

export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  input: '#1e3a5f',
  ai: '#2d1b4e',
  code: '#1a3a2a',
  data: '#183b3b',
  output: '#3a2000',
  gui: '#4a1d3a',
};

export const NODE_TYPE_ICON: Record<NodeType, string> = {
  input: '📥',
  ai: '🤖',
  code: '⚙️',
  data: '🗃️',
  output: '📤',
  gui: '🖥️',
};

