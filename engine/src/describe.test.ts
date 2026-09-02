import { describe, it, expect } from 'vitest';
import { authoredIn, generations } from './describe.ts';
import { parseGraph } from './graph.ts';

/**
 * Which config key holds the text a person wrote, per element.
 *
 * The editor's file layer used to answer this itself, in a second language,
 * from a table it kept beside the elements — and that copy is how one element
 * came to name a `.py` long after the last Python body was gone. It asks the
 * elements now, and these are the answers it gets.
 */

function graph(nodes: unknown[]) {
  return parseGraph({ metadata: { name: 'T' }, nodes, edges: [] });
}

function node(id: string, node_type: string, config: Record<string, unknown> = {}) {
  return { id, node_type, label: id, config };
}

describe('the authored bodies of a graph', () => {
  it('names the field, the prompt and the extension for each kind', () => {
    const found = authoredIn(graph([
      node('c', 'code'),
      node('a', 'ai'),
      node('d', 'data'),
    ]));

    expect(found).toEqual([
      { node_id: 'c', widget_id: '', body_field: 'code', prompt_field: 'code_prompt', extension: '.js', prompt_on_node: false },
      { node_id: 'a', widget_id: '', body_field: 'system_prompt', prompt_field: 'description', extension: '.md', prompt_on_node: true },
      { node_id: 'd', widget_id: '', body_field: 'data_format_prompt', prompt_field: 'data_prompt', extension: '.md', prompt_on_node: false },
    ]);
  });

  it('leaves out an element with nothing anybody writes', () => {
    expect(authoredIn(graph([node('i', 'input'), node('o', 'output')]))).toEqual([]);
  });

  it('gives an input a selector only while it points at a directory', () => {
    expect(authoredIn(graph([node('i', 'input', { input_mode: 'directory' })]))).toEqual([
      { node_id: 'i', widget_id: '', body_field: 'selector_code', prompt_field: 'selector_prompt', extension: '.js', prompt_on_node: false },
    ]);
  });

  it('reaches into a gui node and reports its blocks', () => {
    const found = authoredIn(graph([
      node('g', 'gui', {
        gui_widgets: [
          { id: 'w1', kind: 'text_io', label: 'Answer' },
          { id: 'w2', kind: 'plot_window', label: 'Chart' },
          { id: 'w3', kind: 'input_picker', mode: 'directory' },
        ],
      }),
    ]));

    // The text box authors nothing; the other two do, and both belong to `g`.
    expect(found).toEqual([
      { node_id: 'g', widget_id: 'w2', body_field: 'code', prompt_field: 'code_prompt', extension: '.js', prompt_on_node: false },
      { node_id: 'g', widget_id: 'w3', body_field: 'selector_code', prompt_field: 'selector_prompt', extension: '.js', prompt_on_node: false },
    ]);
  });
});

describe('how an element gets its body written', () => {
  it('writes into the field the same element authors', () => {
    // One constant per element feeds both declarations, so this cannot drift --
    // and it is the failure that would otherwise be invisible: a button filling
    // a config key nothing ever runs.
    const found = generations();
    expect(found.code).toMatchObject({ target_field: 'code', prompt_field: 'code_prompt', kind: 'code' });
    expect(found.ai).toMatchObject({ target_field: 'system_prompt', prompt_field: 'description', prompt_on_node: true });
    expect(found.input).toMatchObject({ target_field: 'selector_code', inputs: ['files'], outputs: ['files'] });
  });

  it('gives the same declaration to the input node and the picker block', () => {
    const found = generations();
    expect(found.input).toEqual(found.input_picker);
  });

  it('tells a drawing block what its snippet must return, and every one of them', () => {
    const found = generations();
    for (const kind of ['plot_window', 'image_view', 'table']) {
      expect(found[kind].contract).toContain('run(inputs)');
      expect(found[kind].inputs).toEqual(['value']);
    }
  });

  it('offers nothing to an element that authors nothing', () => {
    const found = generations();
    for (const name of ['output', 'gui', 'text', 'divider', 'spacer', 'text_io']) {
      expect(found[name]).toBeUndefined();
    }
  });
});
