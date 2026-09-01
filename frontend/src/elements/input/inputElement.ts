import type { GraphNode } from '../../types/graph';
import type { NodeElementDefinition } from '../types';
import InputEditor from './InputEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';
import { derivedNodePorts } from '../../utils/guiWidgets';
import { codeExtension } from '../shared/authoredFileName';
import type { Port } from '../../types/graph';


export const inputElement: NodeElementDefinition = {
  nodeType: 'input',
  ConfigEditor: InputEditor,
  // In directory mode the selector is real code and gets a real file -- the
  // same one an input_picker widget gets, because it is the same behaviour one
  // level up. A text or single-file input authors nothing.
  authoredFile: (node) => (node.config.input_mode === 'directory'
    ? { extension: codeExtension(node.config), what: 'this file selector' }
    : undefined),
  generation: {
    promptField: 'selector_prompt',
    targetField: 'selector_code',
    available: (node) => node.config.input_mode === 'directory',
    guard: 'Please describe which files to select first.',
    success: '✅ Selector generated!',
    promptLabel: 'Prompt text',
    promptPlaceholder: 'Select Markdown files that contain API documentation',
    bodyLabel: 'Code window (editable) — run(inputs) receives {"files"} and must return {"files"}',
    language: true,
    bodyHeight: 140,
  },
  describeOutput: (node) => {
    const mode = node.config.input_mode ?? 'text';
    if (mode === 'directory') return 'a list of file paths';
    if (mode === 'file') return 'a file path';
    return 'text';
  },
  create: (id) => {
    // A new input starts in text mode, and its ports follow from that -- asked
    // of the element rather than listed again here.
    const node = {
      id,
      node_type: 'input' as const,
      label: 'Input',
      description: 'A text value, file, or directory',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      config: { ...baseNodeConfig(), input_mode: 'text' as const },
    } satisfies GraphNode;
    return { ...node, ...(derivedNodePorts(node) ?? {}) };
  },
};
