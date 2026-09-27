import { describe, expect, it } from 'vitest';
import { graphEdge } from './wires';

describe('a wire, as the graph file saves it', () => {
  it('names its ends for the file', () => {
    expect(graphEdge({ id: 'w', source: 'a', sourceHandle: 'rows', target: 'b', targetHandle: 'csv' })).toEqual({
      id: 'w', source_node_id: 'a', source_port_id: 'rows', target_node_id: 'b', target_port_id: 'csv',
    });
  });

  it('reads a missing handle as the port a saved graph means by it, whoever asks', () => {
    // The sweep and the file-port rule read '' here while the saved file said
    // `output` and `input`: the same wire, two answers.
    expect(graphEdge({ source: 'a', target: 'b', sourceHandle: null }, 3)).toEqual({
      id: 'e3', source_node_id: 'a', source_port_id: 'output', target_node_id: 'b', target_port_id: 'input',
    });
  });
});
