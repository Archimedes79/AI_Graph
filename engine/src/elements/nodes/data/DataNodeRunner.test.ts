import { describe, it, expect } from 'vitest';
import { DataNodeRunner } from './DataNodeRunner.ts';
import { quietRuntime } from '../../../../test/fakes.ts';
import type { GraphNode } from '../../../graph.ts';

/**
 * What a data node hands on when it holds nothing.
 *
 * Clearing a structure node's value stores null. It used to be handed on as
 * "" -- a string, which `inputs.input ?? []` lets straight through, so the
 * node downstream called `.push` on text -- while the sample its ✨ was
 * written against said there was nothing at all.
 */

function dataNode(config: Record<string, unknown>): GraphNode {
  return {
    id: 'store', node_type: 'data', label: 'Store', description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
  };
}

const nowhere = quietRuntime({ files: { exists: async () => false } });

const element = new DataNodeRunner();

describe('a data node holding nothing', () => {
  it('hands on null when it holds a structure', async () => {
    expect(await element.execute(dataNode({ data_format: 'structure', data_value: null }), {}, nowhere)).toEqual({ output: null });
    expect(await element.execute(dataNode({ data_format: 'structure' }), {}, nowhere)).toEqual({ output: null });
  });

  it('hands on empty text when it holds text, as a new node starts', async () => {
    expect(await element.execute(dataNode({ data_format: 'text', data_value: null }), {}, nowhere)).toEqual({ output: '' });
    // No format said is text: the kind the editor fills in for a node without one.
    expect(await element.execute(dataNode({}), {}, nowhere)).toEqual({ output: '' });
  });

  it('hands on what it holds, and what arrives over it', async () => {
    expect(await element.execute(dataNode({ data_format: 'structure', data_value: [1, 2] }), {}, nowhere)).toEqual({ output: [1, 2] });
    expect(await element.execute(dataNode({ data_format: 'structure', data_value: null }), { input: [3] }, nowhere)).toEqual({ output: [3] });
  });
});

describe('a data node is its value', () => {
  it('keeps no writing of its own and has no body to write: no task.md, no format.md, no ✨', () => {
    // It had a task and a format beside the value, each a file of its own and
    // a ✨ of its own, and the neighbours were written against the format
    // while they were handed the value.
    const node = dataNode({ data_format: 'structure', data_value: { count: 2 } });
    expect(element.texts(node)).toEqual([]);
    expect(element.logic(node)).toBeUndefined();
    expect(element.generation()).toBeUndefined();
    expect(element.graphAuthorNote()).not.toMatch(/data_prompt|data_format_prompt|format\.md|schema/);
  });
});
