import { describe, it, expect } from 'vitest';
import { collectedInterface, inferInterface, inferSchema, merge, mismatches } from './interface.ts';
import { executeGraph } from './executor.ts';
import { registry } from '../elements/registry.ts';
import { parseGraph } from '../graph.ts';
import { quietRuntime } from '../../test/fakes.ts';

describe('inferring an interface from a run', () => {
  it('describes what a node produced, port by port', () => {
    expect(inferInterface({ rows: [{ Country: 'India', Population: 1450000000 }], count: 20, note: null })).toEqual({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: { Country: { type: 'string' }, Population: { type: 'integer' } },
            required: ['Country', 'Population'],
          },
        },
        count: { type: 'integer' },
        // Null said nothing about the port; it is not required either.
        note: {},
      },
      required: ['rows', 'count'],
    });
  });

  it('describes a list by what its items have in common', () => {
    const schema = inferSchema([{ a: 1, b: 'x' }, { a: 2.5 }]);
    expect(schema).toEqual({
      type: 'array',
      items: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'string' } }, required: ['a'] },
    });
  });

  it('keeps both types where items disagree, and says nothing of an empty list\'s items', () => {
    expect(merge({ type: 'string' }, { type: 'integer' })).toEqual({ type: ['integer', 'string'] });
    expect(inferSchema([])).toEqual({ type: 'array' });
  });

  it('keeps a column\'s type though one row has nothing in it', () => {
    // One missing Population must not make the column "anything": a later run
    // with text there has to be caught.
    const schema = inferSchema({ rows: [{ Population: 1450000000 }, { Population: null }] });
    expect(mismatches({ rows: [{ Population: 'many' }] }, schema)).toEqual(['output.rows[0].Population is string; output.js says integer']);
    expect(inferSchema([1, null, 2])).toEqual({ type: 'array', items: { type: 'integer' } });
  });

  it('stops describing at a sensible depth', () => {
    let deep: unknown = 'leaf';
    for (let level = 0; level < 12; level += 1) deep = { next: deep };
    expect(JSON.stringify(inferSchema(deep))).not.toContain('leaf');
  });
});

describe('holding a run to its interface', () => {
  const schema = inferInterface({ rows: [{ Population: 1 }], count: 3 });

  it('finds nothing wrong with values of the same shape', () => {
    expect(mismatches({ rows: [{ Population: 5 }, { Population: 7 }], count: 9 }, schema)).toEqual([]);
  });

  it('names the place that broke it', () => {
    expect(mismatches({ rows: [{ Population: 'many' }], count: 3 }, schema))
      .toEqual(['output.rows[0].Population is string; output.js says integer']);
    expect(mismatches({ rows: [] }, schema)).toEqual(['output.count is missing']);
    expect(mismatches({ rows: 'none', count: 1 }, schema)).toEqual(['output.rows is string; output.js says array']);
  });

  it('reports a few problems, not one per row', () => {
    const rows = Array.from({ length: 100 }, () => ({ Population: 'x' }));
    expect(mismatches({ rows, count: 1 }, schema)).toHaveLength(5);
  });

  it('accepts an integer where a number is asked for', () => {
    expect(mismatches(4, { type: 'number' })).toEqual([]);
  });

});

describe('what a node run once per item hands on', () => {
  it('is a list on every output declared one, of what one call returns -- a list one call returns, flattened', () => {
    const one = inferInterface({ name: 'Anna', tags: ['a'], count: 2 });
    const handed = collectedInterface(one, new Set(['name', 'tags']));
    expect(handed.properties?.name).toEqual({ type: 'array', items: { type: 'string' } });
    expect(handed.properties?.tags).toEqual({ type: 'array', items: { type: 'string' } });
    expect(handed.properties?.count).toEqual({ type: 'integer' });
  });
});

describe('a run held to its output.js', () => {
  const runtime = (produces: Record<string, unknown>) => quietRuntime({ code: { run: async () => produces } });
  const graphWith = (definition: string | undefined, perItem = false) => parseGraph({
    metadata: { name: 't' },
    nodes: [{
      id: 'count', node_type: 'code', label: 'Count',
      inputs: [{ id: 'text', name: 'Text', kind: 'input', data_type: 'any', multi: true }],
      outputs: [{ id: 'total', name: 'Total', kind: 'output', data_type: 'any', multi: true }],
      config: { code: 'function run() {}', batch_mode: perItem ? 'per_item' : 'whole_list', ...(definition ? { output_definition: definition } : {}) },
    }],
    edges: [],
  });

  it('says so on the node when what comes out does not fit, and still runs', async () => {
    const result = await executeGraph(graphWith('module.exports = { "total": 7 };'), { runtime: runtime({ total: 'seven' }), registry });
    const count = result.node_results[0];
    expect(count.status).toBe('success');
    expect(count.outputs).toEqual({ total: 'seven' });
    expect(count.messages).toEqual(['Does not fit its output.js: output.total is string; output.js says integer']);
  });

  it('says nothing when it fits, or when there is no output.js', async () => {
    const fits = await executeGraph(graphWith('module.exports = { "total": 7 };'), { runtime: runtime({ total: 9 }), registry });
    expect(fits.node_results[0].messages).toBeUndefined();
    const none = await executeGraph(graphWith(undefined), { runtime: runtime({ total: 'anything' }), registry });
    expect(none.node_results[0].messages).toBeUndefined();
  });

  it('holds a node run once per item to the list its calls are collected into', () => {
    const node = graphWith('module.exports = { "total": 7 };', true).nodes[0];
    expect(registry.node('code')!.outputInterface(node)?.properties?.total).toEqual({ type: 'array', items: { type: 'integer' } });
  });
});
