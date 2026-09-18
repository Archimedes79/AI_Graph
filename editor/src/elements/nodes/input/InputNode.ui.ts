import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import type { NodeUi } from '../../ElementUi';
import { baseNodeConfig } from '../baseNodeConfig';
import { derivedNodePorts } from '../gui/guiWidgets';
import { InputNode } from '@engine/elements/nodes/input/InputNode.ts';
import { fromEngine } from '@/authoring/generation';

export const inputNodeUi: NodeUi = {
  nodeType: 'input',
  Panel: lazy(() => import('./InputNodePanel')),
  generation: {
    ...fromEngine(new InputNode().generation()),
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
