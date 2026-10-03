import { describe, it, expect } from 'vitest';
import { parseGraph, type ExecutionResult, type Graph } from '../graph.ts';
import { registry } from '../elements/registry.ts';
import { problemsIn } from '../project/check.ts';
import {
  NotOffered, applyValues, checkValues, eventOf, interfaceOf, interfaceProblems, outputsOf, valuesOf,
} from './graphInterface.ts';

/**
 * A graph used from outside, by name: what any frontend, script or model
 * calls -- a block by its id, an input, output or trigger node by its own --
 * and never a port.
 */

const tool = (): Graph => parseGraph({
  metadata: { name: 'tool' },
  nodes: [
    {
      id: 'page', node_type: 'gui', config: {
        gui_widgets: [
          { id: 'title', kind: 'text', value: 'A tool' },
          { id: 'go', kind: 'button', label: 'Go' },
          { id: 'length', kind: 'select', label: 'Length', options: 'short\nlong', value: 'short' },
          { id: 'talk', kind: 'chat', label: 'Talk' },
          { id: 'plot', kind: 'plot_window', label: 'Plot' },
          { id: 'both', kind: 'text_io', mode: 'both', label: 'Both' },
        ],
      },
    },
    { id: 'topic', node_type: 'input', label: 'Topic', config: { value: 'cats' } },
    { id: 'clock', node_type: 'trigger', config: { trigger_every: '5m' } },
    { id: 'report', node_type: 'output', label: 'Report', inputs: [{ id: 'value', name: 'value', kind: 'input', data_type: 'text' }], config: { write_mode: 'file', value: 'out.md' } },
  ],
});

const names = (entries: { name: string }[]) => entries.map((entry) => entry.name);

describe('what a graph offers', () => {
  it('names a block by its id and a node by its own, in three kinds, with no node or port in sight', () => {
    const offered = interfaceOf(tool(), registry);
    expect(names(offered.events)).toEqual(['go', 'talk', 'clock']);
    expect(names(offered.values)).toEqual(['length', 'talk', 'both', 'topic', 'report']);
    expect(names(offered.outputs)).toEqual(['talk', 'plot', 'both', 'report']);
    expect(offered.values.find((entry) => entry.name === 'length')).toEqual({ name: 'length', label: 'Length', type: 'text' });
    expect(JSON.stringify(offered)).not.toMatch(/_out"|_in"|"page"|"node_id"|"port"/);
  });

  it('offers a heading and a divider nothing: they are the design', () => {
    const offered = interfaceOf(tool(), registry);
    expect([...names(offered.events), ...names(offered.values), ...names(offered.outputs)]).not.toContain('title');
  });

  it('starts the round an event names -- none is the whole graph -- and refuses one it does not offer', () => {
    expect(eventOf(tool(), 'go', registry)).toEqual({ node_id: 'page', port_id: 'go_out' });
    expect(eventOf(tool(), 'clock', registry)).toEqual({ node_id: 'clock', port_id: 'fired' });
    expect(eventOf(tool(), null, registry)).toBeNull();
    expect(() => eventOf(tool(), 'length', registry)).toThrow(NotOffered);
    expect(() => eventOf(tool(), 'nothing', registry)).toThrow(/No event called "nothing": this graph starts on "go", "talk", "clock"/);
  });
});

describe('values by name', () => {
  it('go where each node keeps them, and read back from there', () => {
    const graph = tool();
    applyValues(graph, { length: 'long', topic: 'dogs', report: 'elsewhere.md', talk: 'hello' }, registry);
    expect(valuesOf(graph, registry)).toMatchObject({
      length: 'long', topic: 'dogs', report: 'elsewhere.md', talk: { messages: [], pending: 'hello' },
    });
  });

  it('are refused, all of them, when one names nothing the graph takes -- an event or a heading included', () => {
    const graph = tool();
    for (const wrong of [{ length: 'long', go: true }, { title: 'written over' }, { nobody: 1 }]) {
      expect(() => applyValues(graph, wrong, registry)).toThrow(NotOffered);
    }
    expect(valuesOf(graph, registry).length).toBe('short');
    expect(() => checkValues(graph, { length: 'long' }, registry)).not.toThrow();
  });

  it('give a chat the message in hand, and keep what was said before', () => {
    const graph = tool();
    applyValues(graph, { talk: { messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], pending: '' } }, registry);
    applyValues(graph, { talk: 'and now?' }, registry);
    expect(valuesOf(graph, registry).talk).toEqual({
      messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], pending: 'and now?',
    });
  });
});

describe('outputs by name', () => {
  it('are what a round shows -- a display as drawn, a block that also hands on what arrived, an output node what is wired in', () => {
    const result: ExecutionResult = {
      status: 'success', outputs: {},
      node_results: [
        { node_id: 'page', status: 'success', inputs: { both_in: 'a reply', talk_in: 'an answer' }, outputs: {}, display: { plot: { points: [1, 2] } } },
        { node_id: 'report', status: 'success', inputs: { value: 'the report' }, outputs: {} },
      ],
    };
    expect(outputsOf(tool(), result, registry)).toEqual({
      talk: 'an answer', plot: { points: [1, 2] }, both: 'a reply', report: 'the report',
    });
  });

  it('leave out what the round did not reach', () => {
    const result: ExecutionResult = { status: 'success', outputs: {}, node_results: [{ node_id: 'report', status: 'success', inputs: { value: 'x' }, outputs: {} }] };
    expect(outputsOf(tool(), result, registry)).toEqual({ report: 'x' });
    expect(outputsOf(tool(), null, registry)).toEqual({});
  });
});

describe('a name two nodes offer', () => {
  it('is a problem check names: a caller only ever reaches the first', () => {
    const graph = tool();
    graph.nodes.push(parseGraph({ nodes: [{ id: 'length', node_type: 'input', config: { value: 'x' } }] }).nodes[0]);
    expect(interfaceProblems(graph, registry)).toEqual([{
      where: 'node "length"',
      problem: 'It offers the value "length", which block "length" on "page" offers already: a caller only ever reaches that one.',
      fix: 'Give it an id of its own: whatever uses the graph from outside calls a value by its id.',
    }]);
    expect(problemsIn(graph).map((problem) => problem.where)).toContain('node "length"');
  });

  it('is not one when a block and a node of the same name offer different kinds', () => {
    const graph = tool();
    graph.nodes.push(parseGraph({ nodes: [{ id: 'plot', node_type: 'input', config: { value: 'x' } }] }).nodes[0]);
    expect(interfaceProblems(graph, registry)).toEqual([]);
  });
});
