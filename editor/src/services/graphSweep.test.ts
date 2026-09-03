import { describe, it, expect, vi } from 'vitest';
import { generationOrder, missingExamples, sampleFromPredecessors, sweep, type SweepStep, type SweepUnit } from './graphSweep';
import { NODE_ELEMENTS } from '../elements/registry';
import type { GraphEdge, GraphNode } from '../types/graph';

/**
 * Generating a graph front to back.
 *
 * The order is the engine's — asserted here only in that this uses it, not
 * a second copy of it — and the rules around it are what this file is about:
 * what stops a sweep, what merely reports, and what it refuses to guess at.
 */

function node(id: string, type = 'code'): GraphNode {
  return NODE_ELEMENTS[type as keyof typeof NODE_ELEMENTS].create(id);
}

function edge(from: string, to: string): GraphEdge {
  return {
    id: `${from}->${to}`,
    source_node_id: from, source_port_id: 'output',
    target_node_id: to, target_port_id: 'text',
  } as GraphEdge;
}

/** A unit that always succeeds, recording the order it was run in. */
function ok(seen: string[], id: string): SweepUnit<string> {
  return { run: async () => { seen.push(id); return `${id}-result`; }, apply: () => {} };
}

async function collect(gen: AsyncGenerator<SweepStep>): Promise<SweepStep[]> {
  const steps: SweepStep[] = [];
  for await (const step of gen) steps.push(step);
  return steps;
}

describe('the order a graph is generated in', () => {
  it('follows the wiring, not the order nodes were added', () => {
    const [a, b, c] = [node('a'), node('b'), node('c')];
    // Added c, b, a; wired a -> b -> c.
    const order = generationOrder([c, b, a], [edge('a', 'b'), edge('b', 'c')]);
    expect(order.map((t) => t.key)).toEqual(['a', 'b', 'c']);
  });

  it('refuses a graph that cannot run, the way the engine does', () => {
    // A two-node cycle with no memory element to absolve it. There is no order
    // to generate in, and inventing one would write every node against a guess
    // while looking like it worked.
    const [a, b] = [node('a'), node('b')];
    expect(() => generationOrder([a, b], [edge('a', 'b'), edge('b', 'a')]))
      .toThrow(/cycle/i);
  });
});

describe('sweeping a graph', () => {
  it('generates in order and reports one step per node', async () => {
    const seen: string[] = [];
    const nodes = [node('a'), node('b')];
    const steps = await collect(sweep(nodes, [edge('a', 'b')], {
      unitFor: (t) => ok(seen, t.key),
    }));

    expect(seen).toEqual(['a', 'b']);
    expect(steps.map((s) => s.status)).toEqual(['generated', 'generated']);
  });

  it('skips a node with nothing to generate without calling anything', async () => {
    const steps = await collect(sweep([node('a')], [], { unitFor: () => undefined }));
    expect(steps).toEqual([expect.objectContaining({ status: 'skipped' })]);
  });

  it('reports a node that is missing its request, and keeps going', async () => {
    const seen: string[] = [];
    const nodes = [node('a'), node('b')];
    const steps = await collect(sweep(nodes, [edge('a', 'b')], {
      unitFor: (t) => (t.key === 'a'
        ? { guard: () => 'Please add a code generation prompt first.', run: async () => '', apply: () => {} }
        : ok(seen, t.key)),
    }));

    expect(steps.map((s) => s.status)).toEqual(['blocked', 'generated']);
    // A node with no request of its own may already hold a body that works.
    expect(seen).toEqual(['b']);
  });

  it('stops at a failure instead of writing the rest against nothing', async () => {
    const seen: string[] = [];
    const nodes = [node('a'), node('b'), node('c')];
    const steps = await collect(sweep(nodes, [edge('a', 'b'), edge('b', 'c')], {
      unitFor: (t) => (t.key === 'b'
        ? { run: async () => { throw new Error('the model refused'); }, apply: () => {} }
        : ok(seen, t.key)),
    }));

    expect(steps.map((s) => s.status)).toEqual(['generated', 'failed']);
    expect(steps[1].message).toBe('the model refused');
    expect(seen).toEqual(['a']);
  });

  it('stops when the toolbar says so, between nodes', async () => {
    const seen: string[] = [];
    const nodes = [node('a'), node('b')];
    const stopped = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const steps = await collect(sweep(nodes, [edge('a', 'b')], {
      unitFor: (t) => ok(seen, t.key), stopped,
    }));

    expect(seen).toEqual(['a']);
    expect(steps).toHaveLength(1);
  });
});

describe('what a sweep would have to guess at', () => {
  it('names a file input with no example attached', () => {
    const source = node('src', 'input');
    source.config.input_mode = 'file';
    expect(missingExamples([source], []).map((n) => n.id)).toEqual(['src']);

    source.config.example_file = '/data/sample.csv';
    expect(missingExamples([source], [])).toEqual([]);
  });

  it('takes a stated contract instead, when no file can be handed over', () => {
    const source = node('src', 'input');
    source.config.input_mode = 'directory';
    expect(missingExamples([source], [])).toHaveLength(1);

    source.config.output_format_prompt = 'UTF-8 CSV: date, amount, description';
    expect(missingExamples([source], [])).toEqual([]);
  });

  it('leaves alone a text input, whose value is its own example', () => {
    const source = node('src', 'input');
    source.config.input_mode = 'text';
    expect(missingExamples([source], [])).toEqual([]);
  });

  it('leaves alone a node that is fed by another, which will describe itself', () => {
    const source = node('src', 'input');
    source.config.input_mode = 'file';
    const fed = node('b');
    expect(missingExamples([source, fed], [edge('src', 'b')]).map((n) => n.id)).toEqual(['src']);
    expect(missingExamples([fed], [edge('src', 'b')])).toEqual([]);
  });
});

describe('what the next node is generated against', () => {
  /** A plain node target, for the cases that have nothing to do with a page. */
  const plain = (id: string) => ({ node: node(id), key: id, label: id });
  const wire = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ source, sourceHandle, target, targetHandle });

  it('is what the node before it returned, port by port', () => {
    const produced = new Map([['a', { out: 'text from a', count: 3 }]]);
    expect(sampleFromPredecessors(plain('b'), [wire('a', 'out', 'b', 'text'), wire('a', 'count', 'b', 'n')], produced))
      .toEqual({ text: 'text from a', n: 3 });
  });

  it('collects several sources into a list, as a run would', () => {
    const produced = new Map([['a', { out: 1 }], ['c', { out: 2 }]]);
    expect(sampleFromPredecessors(plain('b'), [wire('a', 'out', 'b', 'items'), wire('c', 'out', 'b', 'items')], produced))
      .toEqual({ items: [1, 2] });
  });

  it('is nothing at all when no predecessor has produced anything yet', () => {
    expect(sampleFromPredecessors(plain('b'), [wire('a', 'out', 'b', 'text')], new Map())).toBeUndefined();
  });
});

describe('a GUI file picker as a source', () => {
  function guiWithPicker(value: string): GraphNode {
    const source = node('g', 'gui');
    source.config.gui_widgets = [
      { id: 'w1', kind: 'input_picker', label: 'Pick', value, mode: 'file' } as never,
    ];
    return source;
  }

  it('is flagged like an unfed file input, when it has no default path', () => {
    expect(missingExamples([guiWithPicker('')], []).map((n) => n.id)).toEqual(['g']);
  });

  it('is left alone once a default path is set', () => {
    expect(missingExamples([guiWithPicker('/data/sample.csv')], [])).toEqual([]);
  });

  it('is flagged even when another block in the same node is wired', () => {
    const source = guiWithPicker('');
    const fed = node('b');
    const edges = [{
      id: 'e', source_node_id: 'a', source_port_id: 'out',
      target_node_id: 'g', target_port_id: 'other_in',
    } as GraphEdge];
    expect(missingExamples([source, fed], edges).map((n) => n.id)).toEqual(['g']);
  });
});

describe('a page in the order', () => {
  /**
   * The chain that made this necessary, and the reason a page cannot simply be
   * walked in list order: its blocks have no edges among themselves, and what
   * connects them runs out through the graph and back.
   *
   *   [page] picker ──→ code node ──→ [page] chart
   *
   * So the blocks stand in the graph in their node's place, and one sort
   * answers for both kinds at once.
   */
  function plotterish(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const page = node('panel', 'gui');
    page.config.gui_widgets = [
      { id: 'title', kind: 'text', label: 'Title', value: 'x' },
      { id: 'picker', kind: 'input_picker', label: 'CSV', mode: 'file', value: '/data.csv' },
      { id: 'chart', kind: 'plot_window', label: 'Chart' },
    ] as never;
    const code = node('points', 'code');
    return {
      nodes: [page, code],
      edges: [
        {
          id: 'e1', source_node_id: 'panel', source_port_id: 'picker_out',
          target_node_id: 'points', target_port_id: 'csv',
        },
        {
          id: 'e2', source_node_id: 'points', source_port_id: 'points',
          target_node_id: 'panel', target_port_id: 'chart_in',
        },
      ] as GraphEdge[],
    };
  }

  it('puts each block where its wiring says, not where the page lists it', () => {
    const { nodes, edges } = plotterish();
    expect(generationOrder(nodes, edges).map((t) => t.key))
      .toEqual(['panel::picker', 'points', 'panel::chart']);
  });

  it('leaves out the blocks that have no ports and generate nothing', () => {
    const { nodes, edges } = plotterish();
    expect(generationOrder(nodes, edges).map((t) => t.key)).not.toContain('panel::title');
  });

  it('names a block by its page and itself, so a step says which one', () => {
    const { nodes, edges } = plotterish();
    const chart = generationOrder(nodes, edges).find((t) => t.key === 'panel::chart');
    expect(chart?.label).toBe(`${nodes[0].label} / Chart`);
    expect(chart?.widget?.id).toBe('chart');
  });

  it('hands a block what the node before it produced, as its transform sees it', () => {
    const { nodes, edges } = plotterish();
    const chart = generationOrder(nodes, edges).find((t) => t.key === 'panel::chart')!;
    const produced = new Map([['points', { points: [{ label: 'a', value: 1 }] }]]);
    const wired = edges.map((e) => ({
      source: e.source_node_id, sourceHandle: e.source_port_id,
      target: e.target_node_id, targetHandle: e.target_port_id,
    }));
    // `{value: ...}` -- the shape a block's own contract promises it, not the
    // port name the graph used to get there.
    expect(sampleFromPredecessors(chart, wired, produced, new Set(['panel'])))
      .toEqual({ value: [{ label: 'a', value: 1 }] });
  });
});
