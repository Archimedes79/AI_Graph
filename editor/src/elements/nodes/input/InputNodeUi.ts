import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { InputNodeElement } from '@engine/elements/nodes/input/InputNodeElement.ts';
import { NodeUi } from '../../NodeUi';
import { baseNodeConfig } from '../baseNodeConfig';
import { derivedNodePorts } from '../gui/guiWidgets';

export class InputNodeUi extends NodeUi {
  readonly nodeType = 'input';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Input';

  readonly hint = 'A value from outside the graph: typed text, one file, or a directory listing';

  readonly icon = '📥';

  readonly color = 'var(--ui-node-input, #1e3a5f)';

  readonly settings: NodeUi['settings'] = [
    'input_mode', 'value', 'prompt_at_runtime', 'recursive', 'extensions', 'select_all_files',
    'selector_prompt', 'selector_code', 'example_file', 'output_format_prompt', 'catch_errors',
  ];

  override readonly Panel = lazy(() => import('./InputNodePanel'));

  override readonly asksForFormatSample = true;

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(new InputNodeElement().generation()),
    available: (node) => node.config.input_mode === 'directory',
    promptLabel: 'Prompt text',
    promptPlaceholder: 'Select Markdown files that contain API documentation',
    mono: true,
    bodyLabel: 'Code window (editable) — run(inputs) receives {"files"} and must return {"files"}',
    bodyHeight: 140,
  };

  /**
   * A file or a folder is a guess until something describes it: an attached
   * sample, or a stated contract. Text is its own example, and a fed input
   * takes its path from upstream.
   */
  override missingExample(node: GraphNode, fed: boolean): boolean {
    if (fed) return false;
    if (String(node.config.input_mode ?? 'text') === 'text') return false;
    return !String(node.config.example_file ?? '').trim()
      && !String(node.config.output_format_prompt ?? '').trim();
  }

  override describeOutput(node: GraphNode): string {
    const mode = node.config.input_mode ?? 'text';
    // Per port, because a file input offers two things and code written for
    // the path when it is handed the content reads a CSV as a file name.
    if (mode === 'directory') return 'port "Files" carries a list of file paths, port "Count" how many there are';
    if (mode === 'file') return 'port "Content" carries the file\'s text (already read), port "Path" its path';
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
