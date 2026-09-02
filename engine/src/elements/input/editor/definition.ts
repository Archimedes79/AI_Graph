import type { GraphNode } from '@/types/graph';
import type { NodeElementDefinition } from '@/elements/types';
import InputEditor from './Editor';
import { baseNodeConfig } from '@/elements/shared/baseNodeConfig';
import { derivedNodePorts } from '@/utils/guiWidgets';
import type { Port } from '@/types/graph';
import { InputElement } from '../element.ts';
import { fromEngine } from '@/elements/shared/generation';


export const inputElement: NodeElementDefinition = {
  nodeType: 'input',
  ConfigEditor: InputEditor,
  generation: {
    ...fromEngine(new InputElement().generation()),
    available: (node) => node.config.input_mode === 'directory',
    promptLabel: 'Prompt text',
    promptPlaceholder: 'Select Markdown files that contain API documentation',
    mono: true,
    bodyLabel: 'Code window (editable) — run(inputs) receives {"files"} and must return {"files"}',
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
