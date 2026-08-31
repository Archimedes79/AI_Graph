import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../types/graph';
import { syncGuiNodePorts, createGuiWidget, guiWidgetPorts } from './guiWidgets';
import { DEFAULT_WIDGET_SPAN } from '../components/gui/layout';
import { baseNodeConfig } from '../elements/shared/baseNodeConfig';

function blankGuiNode(): GraphNode {
  return {
    id: 'n1',
    node_type: 'gui',
    label: 'GUI Node',
    description: '',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    // The shared defaults rather than a copy of them: this file tests port
    // synchronisation, and a hand-listed config made it break whenever an
    // unrelated field was added to the DSL.
    config: baseNodeConfig(),
  };
}

describe('syncGuiNodePorts', () => {
  it('is a no-op for non-gui nodes', () => {
    const node = { ...blankGuiNode(), node_type: 'input' as const };
    const result = syncGuiNodePorts(node);
    expect(result).toBe(node);
  });

  it('generates the exact port shape for each widget kind', () => {
    let node = blankGuiNode();
    const filePicker = createGuiWidget('input_picker', 'Pick file');
    const dirPicker = { ...createGuiWidget('input_picker', 'Pick dir'), mode: 'directory' };
    const textIo = createGuiWidget('text_io', 'Text');
    const chatIo = createGuiWidget('text_io', 'Chat');
    const plotWindow = createGuiWidget('plot_window', 'Plot');
    node.config.gui_widgets = [filePicker, dirPicker, textIo, chatIo, plotWindow];

    node = syncGuiNodePorts(node);

    expect(node.outputs.map((p) => p.id)).toEqual([
      `${filePicker.id}_out`,
      `${dirPicker.id}_out`,
      `${textIo.id}_out`,
      `${chatIo.id}_out`,
    ]);
    expect(node.inputs.map((p) => p.id)).toEqual([
      `${textIo.id}_in`,
      `${chatIo.id}_in`,
      `${plotWindow.id}_in`,
    ]);

    const fileOut = node.outputs.find((p) => p.id === `${filePicker.id}_out`)!;
    expect(fileOut).toMatchObject({ data_type: 'file_path', multi: false });

    const dirOut = node.outputs.find((p) => p.id === `${dirPicker.id}_out`)!;
    expect(dirOut).toMatchObject({ data_type: 'file_path', multi: true });

    const textIn = node.inputs.find((p) => p.id === `${textIo.id}_in`)!;
    expect(textIn).toMatchObject({ data_type: 'any', multi: false });
    const textOut = node.outputs.find((p) => p.id === `${textIo.id}_out`)!;
    expect(textOut).toMatchObject({ data_type: 'text', multi: false });

    const chatIn = node.inputs.find((p) => p.id === `${chatIo.id}_in`)!;
    expect(chatIn).toMatchObject({ data_type: 'any', multi: false });
    const chatOut = node.outputs.find((p) => p.id === `${chatIo.id}_out`)!;
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
    const widget = createGuiWidget('text_io', 'Text');
    node.config.gui_widgets = [widget];

    const first = syncGuiNodePorts(node);
    const second = syncGuiNodePorts(first);

    expect(second.inputs.map((p) => p.id)).toEqual(first.inputs.map((p) => p.id));
    expect(second.outputs.map((p) => p.id)).toEqual(first.outputs.map((p) => p.id));
  });

  it('removing a widget removes only that widget\'s ports, leaving others identical', () => {
    let node = blankGuiNode();
    const a = createGuiWidget('text_io', 'A');
    const b = createGuiWidget('text_io', 'B');
    const c = createGuiWidget('input_picker', 'C');
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

describe('createGuiWidget sizing', () => {
  it('gives a new widget concrete cells and no size preset', () => {
    // `size` was a second way of saying what w/h say, so the same widget could
    // be described twice and disagree. There is one encoding now.
    const widget = createGuiWidget('text_io', 'A');
    expect({ w: widget.w, h: widget.h }).toEqual(DEFAULT_WIDGET_SPAN);
    expect('size' in widget).toBe(false);
  });

  it('carries no coordinates at all — the list order is the position', () => {
    const widget = createGuiWidget('text_io', 'A');
    expect('x' in widget).toBe(false);
    expect('y' in widget).toBe(false);
  });

  it('sizes page furniture the way a document would', () => {
    // A heading is the full width and one row, like every other text block:
    // it used to get a second row to hang from the bottom of, which was the
    // only text on the page that did not start where the others start. Air
    // between sections is the spacer's job.
    const heading = createGuiWidget('text', 'Titel', 'heading');
    expect({ w: heading.w, h: heading.h }).toEqual({ w: 16, h: 1 });
    expect(heading.tone).toBe('plain');

    // A rule and a spacer are a single row of the grid and nothing else.
    for (const kind of ['divider', 'spacer'] as const) {
      const block = createGuiWidget(kind, '');
      expect({ w: block.w, h: block.h }).toEqual({ w: 16, h: 1 });
      expect(block.tone).toBe('plain');
    }
  });

  it('frames what you operate, and nothing else', () => {
    // Only fields get a box by default. A plot and a table already have a shape
    // of their own, and framing them turned the page into an inspector.
    expect(createGuiWidget('plot_window', 'P').tone).toBe('plain');
    expect(createGuiWidget('table', 'T').tone).toBe('plain');
    expect(createGuiWidget('input_picker', 'F').tone).toBe('sunken');
    expect(createGuiWidget('text_io', 'In', 'input').tone).toBe('sunken');
    // ...except a text block that only ever shows output, which is prose.
    expect(createGuiWidget('text_io', 'Out', 'output').tone).toBe('plain');
  });

  it('page furniture contributes no ports', () => {
    for (const kind of ['text', 'divider', 'spacer'] as const) {
      const ports = guiWidgetPorts(createGuiWidget(kind, kind));
      expect(ports.inputs).toEqual([]);
      expect(ports.outputs).toEqual([]);
    }
  });
});
