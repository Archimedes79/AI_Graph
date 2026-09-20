import { describe, it, expect } from 'vitest';
import { filePorts } from './fileInputs.ts';
import type { DataType, GraphNode, Port } from '../graph.ts';

/**
 * Which inputs are paths to be read, and who gets to say so.
 *
 * This is the rule that made a hand-built plotter fail silently. A code node is
 * created with its input typed `any`, the editor offers no way to change that,
 * and "read file contents from paths" only looked at the node's *own* port
 * types -- so the box was ticked, nothing happened, and the body was handed a
 * filename where it expected a CSV. The run reported success.
 */

const port = (id: string, data_type: DataType): Port => ({
  id, name: id, kind: 'input', data_type, multi: false, required: false, description: '',
});

const node = (inputs: Port[]): GraphNode => ({
  id: 'code', node_type: 'code', label: 'Code', description: '',
  position: { x: 0, y: 0 }, inputs, outputs: [], config: {},
});

const picker: GraphNode = {
  id: 'page', node_type: 'gui', label: 'Page', description: '',
  position: { x: 0, y: 0 }, inputs: [],
  outputs: [{ id: 'file_out', name: 'CSV', kind: 'output', data_type: 'file_path', multi: false, required: false, description: '' }],
  config: {},
};

const wire = (from: string, to: string) => ({
  id: 'e1', source_node_id: 'page', source_port_id: from, target_node_id: 'code', target_port_id: to,
});

describe('which inputs hold a path', () => {
  it('takes a port that says so itself', () => {
    expect(filePorts(node([port('csv', 'file_path'), port('kind', 'text')]))).toEqual(['csv']);
  });

  it('takes a port whose wire comes from one, which is the case the editor can build', () => {
    const graph = { nodes: [picker, node([port('input', 'any')])], edges: [wire('file_out', 'input')] };
    expect(filePorts(node([port('input', 'any')]), graph)).toEqual(['input']);
  });

  it('still refuses an ordinary value, however it is wired', () => {
    // The whole reason the rule exists: a sentence wired into a node must not
    // become "no such file: Once upon a time".
    const text: GraphNode = { ...picker, outputs: [{ ...picker.outputs[0], data_type: 'text' as DataType }] };
    const graph = { nodes: [text, node([port('input', 'any')])], edges: [wire('file_out', 'input')] };
    expect(filePorts(node([port('input', 'any')]), graph)).toEqual([]);
  });

  it('asks nothing of a wire that does not end here', () => {
    const elsewhere = { ...wire('file_out', 'input'), target_node_id: 'somebody_else' };
    const graph = { nodes: [picker, node([port('input', 'any')])], edges: [elsewhere] };
    expect(filePorts(node([port('input', 'any')]), graph)).toEqual([]);
  });

  it('answers without a graph, as a caller holding only the node does', () => {
    expect(filePorts(node([port('input', 'any')]))).toEqual([]);
    expect(filePorts(node([port('csv', 'file_path')]))).toEqual(['csv']);
  });
});

describe('the target port has the last word', () => {
  /**
   * A file reader takes the same picker output twice: once to be read, once to
   * keep the name. Both wires leave a `file_path` output, so only the target's
   * own type can tell them apart — and a rule that asked the wire alone read
   * both, and the summary lost the filename it prints above itself.
   */
  it('leaves a port that asked for text as text, however it is wired', () => {
    const reader = node([port('file', 'file_path'), port('path', 'text')]);
    const graph = {
      nodes: [picker, reader],
      edges: [wire('file_out', 'file'), { ...wire('file_out', 'path'), id: 'e2' }],
    };
    expect(filePorts(reader, graph)).toEqual(['file']);
  });
});
