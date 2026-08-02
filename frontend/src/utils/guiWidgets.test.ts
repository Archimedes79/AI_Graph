import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../types/graph';
import { syncGuiNodePorts, createGuiWidget } from './guiWidgets';

function blankGuiNode(): GraphNode {
  return {
    id: 'n1',
    node_type: 'gui',
    label: 'GUI Node',
    description: '',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    config: {
      prompt_at_runtime: false,
      input_mode: 'text',
      parse_format: 'text',
      parse_code: '',
      example_path: '',
      select_all_files: true,
      selector_prompt: '',
      selector_code: '',
      ai_provider: 'ollama',
      ai_model: 'llama3',
      system_prompt: '',
      temperature: 0.7,
      language: 'python',
      code: '',
      code_prompt: '',
      output_format: 'text',
      output_format_prompt: '',
      output_label: 'Result',
      write_mode: 'none',
      batch_mode: 'per_item',
      read_file_inputs: false,
      gui_widgets: [],
      extra: {},
    },
  };
}

describe('syncGuiNodePorts', () => {
  it('is a no-op for non-gui nodes', () => {
    const node = { ...blankGuiNode(), node_type: 'text_input' as const };
    const result = syncGuiNodePorts(node);
    expect(result).toBe(node);
  });

  it('generates the exact port shape for each widget kind', () => {
    let node = blankGuiNode();
    const fileOpen = createGuiWidget('file_open', 'Pick file');
    const dirOpen = createGuiWidget('directory_open', 'Pick dir');
    const textWindow = createGuiWidget('text_window', 'Text');
    const chatWindow = createGuiWidget('chat_window', 'Chat');
    const plotWindow = createGuiWidget('plot_window', 'Plot');
    node.config.gui_widgets = [fileOpen, dirOpen, textWindow, chatWindow, plotWindow];

    node = syncGuiNodePorts(node);

    expect(node.outputs.map((p) => p.id)).toEqual([
      `${fileOpen.id}_out`,
      `${dirOpen.id}_out`,
      `${textWindow.id}_out`,
      `${chatWindow.id}_out`,
    ]);
    expect(node.inputs.map((p) => p.id)).toEqual([
      `${textWindow.id}_in`,
      `${chatWindow.id}_in`,
      `${plotWindow.id}_in`,
    ]);

    const fileOut = node.outputs.find((p) => p.id === `${fileOpen.id}_out`)!;
    expect(fileOut).toMatchObject({ data_type: 'file_path', multi: false });

    const dirOut = node.outputs.find((p) => p.id === `${dirOpen.id}_out`)!;
    expect(dirOut).toMatchObject({ data_type: 'file_path', multi: true });

    const textIn = node.inputs.find((p) => p.id === `${textWindow.id}_in`)!;
    expect(textIn).toMatchObject({ data_type: 'any', multi: false });
    const textOut = node.outputs.find((p) => p.id === `${textWindow.id}_out`)!;
    expect(textOut).toMatchObject({ data_type: 'text', multi: false });

    const chatIn = node.inputs.find((p) => p.id === `${chatWindow.id}_in`)!;
    expect(chatIn).toMatchObject({ data_type: 'any', multi: false });
    const chatOut = node.outputs.find((p) => p.id === `${chatWindow.id}_out`)!;
    expect(chatOut).toMatchObject({ data_type: 'text', multi: false });

    const plotIn = node.inputs.find((p) => p.id === `${plotWindow.id}_in`)!;
    expect(plotIn).toMatchObject({ data_type: 'any', multi: true, required: false });
  });

  it('plot_window is display-only: one input port, no output port', () => {
    let node = blankGuiNode();
    const plotWindow = createGuiWidget('plot_window', 'Plot');
    node.config.gui_widgets = [plotWindow];

    node = syncGuiNodePorts(node);

    expect(node.inputs.map((p) => p.id)).toEqual([`${plotWindow.id}_in`]);
    expect(node.outputs).toEqual([]);
    expect(node.outputs.find((p) => p.id === `${plotWindow.id}_out`)).toBeUndefined();
  });

  it('keeps port ids stable across re-syncs (edge-preserving)', () => {
    let node = blankGuiNode();
    const widget = createGuiWidget('text_window', 'Text');
    node.config.gui_widgets = [widget];

    const first = syncGuiNodePorts(node);
    const second = syncGuiNodePorts(first);

    expect(second.inputs.map((p) => p.id)).toEqual(first.inputs.map((p) => p.id));
    expect(second.outputs.map((p) => p.id)).toEqual(first.outputs.map((p) => p.id));
  });

  it('removing a widget removes only that widget\'s ports, leaving others identical', () => {
    let node = blankGuiNode();
    const a = createGuiWidget('text_window', 'A');
    const b = createGuiWidget('chat_window', 'B');
    const c = createGuiWidget('file_open', 'C');
    node.config.gui_widgets = [a, b, c];
    node = syncGuiNodePorts(node);

    const beforeAIn = node.inputs.find((p) => p.id === `${a.id}_in`);
    const beforeAOut = node.outputs.find((p) => p.id === `${a.id}_out`);
    const beforeCOut = node.outputs.find((p) => p.id === `${c.id}_out`);

    node.config.gui_widgets = [a, c];
    const afterRemoval = syncGuiNodePorts(node);

    expect(afterRemoval.inputs.map((p) => p.id)).toEqual([`${a.id}_in`]);
    expect(afterRemoval.outputs.map((p) => p.id)).toEqual([`${a.id}_out`, `${c.id}_out`]);
    expect(afterRemoval.inputs.find((p) => p.id === `${a.id}_in`)).toEqual(beforeAIn);
    expect(afterRemoval.outputs.find((p) => p.id === `${a.id}_out`)).toEqual(beforeAOut);
    expect(afterRemoval.outputs.find((p) => p.id === `${c.id}_out`)).toEqual(beforeCOut);
    expect(afterRemoval.inputs.find((p) => p.id === `${b.id}_in`)).toBeUndefined();
    expect(afterRemoval.outputs.find((p) => p.id === `${b.id}_out`)).toBeUndefined();
  });
});
