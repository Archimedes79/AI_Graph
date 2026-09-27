import { describe, it, expect } from 'vitest';
import { DataNodeRunner } from './DataNodeRunner.ts';
import type { Runtime } from '../../Runtime.ts';
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

const nowhere: Runtime = {
  files: { read: async () => '', write: async () => {}, list: async () => [], resolve: (p) => p, exists: async () => false },
  code: { run: async (_body, inputs) => inputs },
  ai: { complete: async () => '' },
};

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
