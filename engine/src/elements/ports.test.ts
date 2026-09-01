import { describe, it, expect } from 'vitest';
import { registry } from '../registry.ts';
import { parseWidget } from './gui.ts';

/**
 * Which ports each block contributes, spelled out.
 *
 * These are what the graph's edges attach to. Two answers to "which ports does
 * this block have" is the one disagreement that silently deletes wires — the
 * editor drawing a port the engine will not produce, or the engine producing
 * one the editor never drew — which is why the editor now asks these same
 * elements instead of keeping its own copy.
 *
 * Both mistakes below were real, and both were found the moment the editor
 * started asking: a text box whose input was typed `text` (so a chart's data
 * could not be wired in to read it) and a display whose input was single-valued
 * (so a second source would have been dropped without a word).
 */

function ports(kind: string, config: Record<string, unknown> = {}) {
  const element = registry.widget(kind)!;
  return element.ports(parseWidget({ id: 'w', kind, label: 'W', ...config }));
}

describe('what each block contributes', () => {
  it('gives a file picker one output, and a folder picker a multi one', () => {
    expect(ports('input_picker').outputs).toEqual([expect.objectContaining({
      id: 'w_out', data_type: 'file_path', multi: false,
    })]);
    expect(ports('input_picker', { mode: 'directory' }).outputs[0]).toMatchObject({
      data_type: 'file_path', multi: true,
    });
    expect(ports('input_picker').inputs).toEqual([]);
  });

  it('gives a text box an input that accepts anything and an output of text', () => {
    const both = ports('text_io', { mode: 'both' });
    expect(both.inputs[0]).toMatchObject({ id: 'w_in', data_type: 'any', multi: false });
    expect(both.outputs[0]).toMatchObject({ id: 'w_out', data_type: 'text' });
  });

  it('gives a text box only what its role needs', () => {
    expect(ports('text_io', { mode: 'input' })).toMatchObject({ inputs: [] });
    expect(ports('text_io', { mode: 'input' }).outputs).toHaveLength(1);
    expect(ports('text_io', { mode: 'output' })).toMatchObject({ outputs: [] });
    expect(ports('text_io', { mode: 'output' }).inputs).toHaveLength(1);
  });

  it('gives every display one multi input and no output', () => {
    for (const kind of ['plot_window', 'image_view', 'table']) {
      const own = ports(kind);
      expect(own.outputs, kind).toEqual([]);
      expect(own.inputs, kind).toEqual([expect.objectContaining({
        id: 'w_in', data_type: 'any', multi: true,
      })]);
    }
  });

  it('gives page furniture no ports at all', () => {
    // A heading is part of the page, not part of the graph. Without these
    // there would be no way to write a title, and an interface built only from
    // inputs and outputs cannot be laid out.
    for (const kind of ['text', 'divider', 'spacer']) {
      expect(ports(kind), kind).toEqual({ inputs: [], outputs: [] });
    }
  });
});
