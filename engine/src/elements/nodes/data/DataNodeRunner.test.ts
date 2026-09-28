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
  it('keeps it in a file of its own, as JSON where it holds structure, and its history beside it', () => {
    expect(element.texts(dataNode({ data_format: 'structure', data_value: { count: 2 } }))).toEqual([
      { field: 'data_value', file: 'data.json', json: true, standard: 'null' },
      { field: 'history', file: 'history.md' },
    ]);
    expect(element.texts(dataNode({ data_format: 'text', data_value: 'hello' }))[0]).toEqual({ field: 'data_value', file: 'data.txt', standard: '' });
  });

  it('holds structure from the moment a run hands it something that is not text: a count stays a count', () => {
    const counter = dataNode({ data_format: 'text', data_value: '' });
    element.settleMemory(counter, 'input', 'one');
    expect(counter.config).toMatchObject({ data_format: 'text', data_value: 'one' });
    element.settleMemory(counter, 'input', 1);
    expect(counter.config).toMatchObject({ data_format: 'structure', data_value: 1 });
    expect(element.texts(counter)[0]).toMatchObject({ file: 'data.json', json: true });
  });

  it('is named by check when it is kept as text and holds structure, set so by hand or by a model: it would come back as text', () => {
    expect(element.problems(dataNode({ data_format: 'text', data_value: [1, 2] }), undefined, 'Node "store"')).toEqual([{
      where: 'Node "store"',
      problem: expect.stringContaining('comes back from data.txt as text'),
      // Said as a person changes it, in its panel; the field only for a graph file.
      fix: 'Set its Kind to Structure (JSON) in its panel (data_format "structure" in a graph file): it is kept in data.json then.',
    }]);
    for (const fine of [{ data_format: 'text', data_value: 'hello' }, { data_format: 'text' }, { data_format: 'structure', data_value: [1] }]) {
      expect(element.problems(dataNode(fine), undefined, 'Node "store"')).toEqual([]);
    }
  });

  it('has its value written by ✨ Data, and nothing that runs', () => {
    const node = dataNode({ data_format: 'structure', data_value: { count: 2 } });
    expect(element.logic(node)).toBeUndefined();
    expect(element.generation()).toMatchObject({ kind: 'data', fields: { body: 'data_value' } });
    expect(element.definitions(node)).toBeUndefined();
    expect(element.graphAuthorNote()).not.toMatch(/data_prompt|data_format_prompt|format\.md|schema/);
  });
});
