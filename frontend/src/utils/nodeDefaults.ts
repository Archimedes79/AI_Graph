import type { GraphNode, NodeType, NodeConfig } from '../types/graph';

const defaultConfig = (): NodeConfig => ({
  value: '',
  prompt_at_runtime: false,
  select_all_files: true,
  selector_code: 'def run(inputs):\n    # inputs["files"] is the full list of file paths in the directory\n    return {"files": inputs.get("files", [])}\n',
  ai_provider: 'ollama',
  ai_model: 'llama3',
  system_prompt: '',
  temperature: 0.7,
  language: 'python',
  code: '',
  output_label: 'Result',
  write_mode: 'none',
  separator: '\n',
  extra: {},
});

export function nodeTypeDefaults(nodeType: NodeType, id: string): GraphNode {
  const cfg = defaultConfig();

  switch (nodeType) {
    case 'text_input':
      return {
        id,
        node_type: 'text_input',
        label: 'Text Input',
        description: 'A static text value',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
        config: cfg,
      };

    case 'file_input':
      return {
        id,
        node_type: 'file_input',
        label: 'File Input',
        description: 'Read a text file',
        position: { x: 0, y: 0 },
        inputs: [{ id: 'path', name: 'Path', kind: 'input', data_type: 'text', multi: false, required: false, description: 'File path (overrides config)' }],
        outputs: [
          { id: 'content', name: 'Content', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
          { id: 'path', name: 'Path', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
        ],
        config: cfg,
      };

    case 'directory_input':
      return {
        id,
        node_type: 'directory_input',
        label: 'Directory Input',
        description: 'List files in a directory',
        position: { x: 0, y: 0 },
        inputs: [{ id: 'path', name: 'Path', kind: 'input', data_type: 'text', multi: false, required: false, description: '' }],
        outputs: [
          { id: 'files', name: 'Files', kind: 'output', data_type: 'list', multi: true, required: false, description: 'List of file paths' },
          { id: 'count', name: 'Count', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
        ],
        config: cfg,
      };

    case 'ai':
      return {
        id,
        node_type: 'ai',
        label: 'AI Node',
        description: 'Send a prompt to an AI model',
        position: { x: 0, y: 0 },
        inputs: [
          { id: 'prompt', name: 'Prompt', kind: 'input', data_type: 'text', multi: false, required: true, description: '' },
          { id: 'context', name: 'Context', kind: 'input', data_type: 'any', multi: true, required: false, description: 'Additional context' },
        ],
        outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
        config: { ...cfg, system_prompt: 'You are a helpful assistant.' },
      };

    case 'code':
      return {
        id,
        node_type: 'code',
        label: 'Code Node',
        description: 'Execute custom code',
        position: { x: 0, y: 0 },
        inputs: [{ id: 'input', name: 'Input', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
        outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'any', multi: false, required: false, description: '' }],
        config: { ...cfg, code: 'def run(inputs):\n    return {"output": inputs.get("input", "")}\n' },
      };

    case 'output':
      return {
        id,
        node_type: 'output',
        label: 'Output',
        description: 'Graph output node',
        position: { x: 0, y: 0 },
        inputs: [{ id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
        outputs: [],
        config: { ...cfg, output_label: 'Result' },
      };

    case 'text_output':
      return {
        id,
        node_type: 'text_output',
        label: 'Text Output',
        description: 'Show text to the user in a text window when the graph runs',
        position: { x: 0, y: 0 },
        inputs: [{ id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
        outputs: [],
        config: { ...cfg, output_label: 'Text Output' },
      };

    case 'merge':
      return {
        id,
        node_type: 'merge',
        label: 'Merge',
        description: 'Merge multiple inputs into one text',
        position: { x: 0, y: 0 },
        inputs: [{ id: 'inputs', name: 'Inputs', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
        outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
        config: { ...cfg, separator: '\n' },
      };

    case 'split':
      return {
        id,
        node_type: 'split',
        label: 'Split',
        description: 'Split text into a list',
        position: { x: 0, y: 0 },
        inputs: [{ id: 'input', name: 'Input', kind: 'input', data_type: 'text', multi: false, required: true, description: '' }],
        outputs: [
          { id: 'items', name: 'Items', kind: 'output', data_type: 'list', multi: true, required: false, description: '' },
          { id: 'count', name: 'Count', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
        ],
        config: { ...cfg, separator: '\n' },
      };

    default:
      return {
        id,
        node_type: nodeType,
        label: nodeType,
        description: '',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        config: cfg,
      };
  }
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  text_input: 'Text Input',
  file_input: 'File Input',
  directory_input: 'Directory',
  ai: 'AI Node',
  code: 'Code Node',
  output: 'Output',
  text_output: 'Text Output',
  merge: 'Merge',
  split: 'Split',
};

export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  text_input: '#1e3a5f',
  file_input: '#1e3a5f',
  directory_input: '#1e3a5f',
  ai: '#2d1b4e',
  code: '#1a3a2a',
  output: '#3a2000',
  text_output: '#0f3a3a',
  merge: '#1a2a3a',
  split: '#3a1a1a',
};

export const NODE_TYPE_ICON: Record<NodeType, string> = {
  text_input: '📝',
  file_input: '📄',
  directory_input: '📁',
  ai: '🤖',
  code: '⚙️',
  output: '📤',
  text_output: '🪟',
  merge: '🔀',
  split: '✂️',
};
