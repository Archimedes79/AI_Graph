import type { GraphNode, NodeType } from '../types/graph';
import { baseNodeConfig } from '../elements/shared/baseNodeConfig';
import { NODE_ELEMENTS } from '../elements/registry';

export function nodeTypeDefaults(nodeType: NodeType, id: string): GraphNode {
  return NODE_ELEMENTS[nodeType].create(id);
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  text_input: 'Text Input',
  file_input: 'File Input',
  directory_input: 'Directory',
  input: 'Input',
  ai: 'AI Node',
  code: 'Code Node',
  output: 'Output',
  text_output: 'Text Output',
  merge: 'Merge',
  split: 'Split',
  gui: 'GUI Node',
};

export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  text_input: '#1e3a5f',
  file_input: '#1e3a5f',
  directory_input: '#1e3a5f',
  input: '#1e3a5f',
  ai: '#2d1b4e',
  code: '#1a3a2a',
  output: '#3a2000',
  text_output: '#0f3a3a',
  merge: '#1a2a3a',
  split: '#3a1a1a',
  gui: '#4a1d3a',
};

export const NODE_TYPE_ICON: Record<NodeType, string> = {
  text_input: '📝',
  file_input: '📄',
  directory_input: '📁',
  input: '📥',
  ai: '🤖',
  code: '⚙️',
  output: '📤',
  text_output: '🪟',
  merge: '🔀',
  split: '✂️',
  gui: '🖥️',
};

export interface NodePreset {
  id: string;
  nodeType: NodeType;
  label: string;
  icon: string;
  description: string;
  build: (id: string) => GraphNode;
}

export const NODE_PRESETS: NodePreset[] = [
  {
    id: 'code_read_file',
    nodeType: 'code',
    label: 'Read File (Code)',
    icon: '📖',
    description: 'Reads each file path into its content (text or base64)',
    build: (id) => ({
      id,
      node_type: 'code',
      label: 'Read File (Code)',
      description: "Reads each file's content from its path; edit the code to post-process it.",
      position: { x: 0, y: 0 },
      inputs: [{ id: 'paths', name: 'File paths', kind: 'input', data_type: 'file_path', multi: true, required: true, description: 'Rooted file paths to read' }],
      outputs: [{ id: 'content', name: 'Content', kind: 'output', data_type: 'text', multi: true, required: false, description: 'One text (or base64) value per file' }],
      config: { ...baseNodeConfig(), read_file_inputs: true, code: 'def run(inputs):\n    return {"content": inputs.get("paths", "")}\n' },
    }),
  },
  {
    id: 'ai_read_file',
    nodeType: 'ai',
    label: 'Read File (AI)',
    icon: '📚',
    description: "Sends each file's content to the AI model",
    build: (id) => ({
      id,
      node_type: 'ai',
      label: 'Read File (AI)',
      description: "Receives each file's content (not just its path) and sends it to the AI model per the description below.",
      position: { x: 0, y: 0 },
      inputs: [{ id: 'paths', name: 'File paths', kind: 'input', data_type: 'file_path', multi: true, required: true, description: 'Rooted file paths to read' }],
      outputs: [{ id: 'output', name: 'Output batch', kind: 'output', data_type: 'text', multi: true, required: false, description: 'One response per file' }],
      config: { ...baseNodeConfig(), read_file_inputs: true, system_prompt: 'You receive the full content of one file at a time. Respond according to the node description.' },
    }),
  },
];
