import { describe, it, expect } from 'vitest';
import { inferInterface, inferSchema, merge, mismatches, readInterface } from './interface.ts';
import { executeGraph } from './executor.ts';
import { registry } from '../elements/registry.ts';
import { parseGraph } from '../graph.ts';
import type { Runtime } from '../elements/Runtime.ts';

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
      .toEqual(['output.rows[0].Population is string; the interface says integer']);
    expect(mismatches({ rows: [] }, schema)).toEqual(['output.count is missing']);
    expect(mismatches({ rows: 'none', count: 1 }, schema)).toEqual(['output.rows is string; the interface says array']);
  });

  it('reports a few problems, not one per row', () => {
    const rows = Array.from({ length: 100 }, () => ({ Population: 'x' }));
    expect(mismatches({ rows, count: 1 }, schema)).toHaveLength(5);
  });

  it('accepts an integer where a number is asked for', () => {
    expect(mismatches(4, { type: 'number' })).toEqual([]);
  });

  it('reads an interface stored as an object or as its JSON text, and nothing else', () => {
    expect(readInterface({ type: 'object' })).toEqual({ type: 'object' });
    expect(readInterface('{"type": "object"}')).toEqual({ type: 'object' });
    expect(readInterface('')).toBeUndefined();
    expect(readInterface('not json')).toBeUndefined();
    expect(readInterface([1])).toBeUndefined();
  });
});

describe('a run with an interface kept', () => {
  const runtime = (produces: Record<string, unknown>): Runtime => ({
    files: { read: async () => '', write: async () => {}, list: async () => [], resolve: (p) => p, exists: async () => true },
    code: { run: async () => produces },
    ai: { complete: async () => '' },
  });
  const graphWith = (outputSchema: unknown) => parseGraph({
    metadata: { name: 't' },
    nodes: [{
      id: 'count', node_type: 'code', label: 'Count', inputs: [],
      outputs: [{ id: 'total', name: 'Total', kind: 'output', data_type: 'any' }],
      config: { code: 'function run() {}', output_schema: outputSchema },
    }],
    edges: [],
  });

  it('says so on the node when the output breaks it, and still runs', async () => {
    const result = await executeGraph(graphWith({ type: 'object', properties: { total: { type: 'integer' } }, required: ['total'] }),
      { runtime: runtime({ total: 'seven' }), registry });
    const count = result.node_results[0];
    expect(count.status).toBe('success');
    expect(count.outputs).toEqual({ total: 'seven' });
    expect(count.messages).toEqual(['Does not match its output interface: output.total is string; the interface says integer']);
  });

  it('says nothing when it fits, or when no interface was kept', async () => {
    const fits = await executeGraph(graphWith({ type: 'object', properties: { total: { type: 'integer' } } }), { runtime: runtime({ total: 7 }), registry });
    expect(fits.node_results[0].messages).toBeUndefined();
    const none = await executeGraph(graphWith(undefined), { runtime: runtime({ total: 'anything' }), registry });
    expect(none.node_results[0].messages).toBeUndefined();
  });
});
