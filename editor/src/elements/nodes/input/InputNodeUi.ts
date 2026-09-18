import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { InputNodeElement } from '@engine/elements/nodes/input/InputNodeElement.ts';
import { NodeUi } from '../../NodeUi';
import { baseNodeConfig } from '../baseNodeConfig';
import { derivedNodePorts } from '../gui/guiWidgets';

export class InputNodeUi extends NodeUi {
  readonly nodeType = 'input';
  readonly label = 'Input';
  readonly hint = 'A value from outside the graph: typed text, one file, or a directory listing';
  readonly icon = '📥';
  readonly color = 'var(--ui-node-input, #1e3a5f)';

  override readonly Panel = lazy(() => import('./InputNodePanel'));

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(new InputNodeElement().generation()),
    available: (node) => node.config.input_mode === 'directory',
    promptLabel: 'Prompt text',
    promptPlaceholder: 'Select Markdown files that contain API documentation',
    mono: true,
    bodyLabel: 'Code window (editable) — run(inputs) receives {"files"} and must return {"files"}',
    bodyHeight: 140,
  };

  override describeOutput(node: GraphNode): string {
    const mode = node.config.input_mode ?? 'text';
    if (mode === 'directory') return 'a list of file paths';
    if (mode === 'file') return 'a file path';
    return 'text';
  }

  create(id: string): GraphNode {
    // A new input starts in text mode, and its ports follow from that -- asked
    // of the engine rather than listed again here.
    const node: GraphNode = {
      id,
      node_type: 'input',
      label: this.label,
      description: 'A text value, file, or directory',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      config: { ...baseNodeConfig(), input_mode: 'text' },
    };
    return { ...node, ...(derivedNodePorts(node) ?? {}) };
  }
}
