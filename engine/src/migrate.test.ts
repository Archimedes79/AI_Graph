import { describe, it, expect } from 'vitest';
import { migrateGraph, migrateNode } from './migrate.ts';
import { parseGraph } from './graph.ts';

/**
 * Files written by an earlier AI-Graph still open.
 *
 * Each case is one retired thing the DSL once had. Ids and ports are never
 * touched, because those are what edges resolve through; everything else is
 * rewritten into what the current elements read.
 */

const raw = (node: Record<string, unknown>) => ({ id: 'n', label: 'N', ...node }) as Record<string, unknown>;

describe('retired node types', () => {
  it('turns a text_input into an input in text mode that prompts', () => {
    const node = migrateNode(raw({ node_type: 'text_input', config: {} })) as Record<string, unknown>;
    expect(node.node_type).toBe('input');
    expect(node.config).toMatchObject({ input_mode: 'text', prompt_at_runtime: true });
  });

  it('turns a text_output into an output that opens a window', () => {
    const node = migrateNode(raw({ node_type: 'text_output', config: {} })) as Record<string, unknown>;
    expect(node.node_type).toBe('output');
    expect(node.config).toMatchObject({ write_mode: 'window' });
  });

  it('turns a widget node into the gui node it always was', () => {
    expect((migrateNode(raw({ node_type: 'widget', config: {} })) as Record<string, unknown>).node_type).toBe('gui');
  });

  it('turns a merge into the code node it was three lines of', () => {
    const node = migrateNode(raw({ node_type: 'merge', config: { merge_mode: 'sum', separator: ',' } })) as { node_type: string; config: Record<string, unknown> };
    expect(node.node_type).toBe('code');
    expect(node.config.code).toContain('reduce((sum, v) => sum + Number(v), 0)');
    expect(node.config.batch_mode).toBe('whole_list');
    expect(node.config.merge_mode).toBeUndefined();
  });

  it('turns a split into code that splits on its separator', () => {
    const node = migrateNode(raw({ node_type: 'split', config: { separator: ';' } })) as { config: Record<string, unknown> };
    expect(node.config.code).toContain('.split(";")');
  });
});

describe('retired widget kinds and fields', () => {
  it('renames a block kind and keeps its id, so its ports stay wired', () => {
    const node = migrateNode(raw({
      node_type: 'gui',
      config: { gui_widgets: [{ id: 'w1', kind: 'chat_window' }, { id: 'w2', kind: 'file_open', mode: 'directory' }] },
    })) as { config: { gui_widgets: Record<string, unknown>[] } };
    expect(node.config.gui_widgets).toEqual([
      { id: 'w1', kind: 'text_io', mode: 'both' },
      { id: 'w2', kind: 'input_picker', mode: 'directory' },     // an explicit mode wins
    ]);
  });

  it('moves renamed fields, the first filled one winning', () => {
    const node = migrateNode(raw({
      node_type: 'code',
      config: { config_context_file: '', output_context_file: '/a.csv', extra: { recursive: true, other: 1 } },
    })) as { config: Record<string, unknown> };
    expect(node.config.example_file).toBe('/a.csv');
    expect(node.config.config_context_file).toBeUndefined();
    expect(node.config.recursive).toBe(true);
    expect(node.config.extra).toEqual({ other: 1 });
  });

  it('expands a size preset into w/h, and a placed grid into reading order', () => {
    const node = migrateNode(raw({
      node_type: 'gui',
      config: {
        gui_grid_columns: 12,
        gui_widgets: [
          { id: 'b', kind: 'text', x: 6, y: 0, w: 6, h: 2 },
          { id: 'a', kind: 'text', x: 0, y: 0, w: 6, h: 2 },
          { id: 'c', kind: 'text', size: 'large' },
        ],
      },
    })) as { config: { gui_widgets: Record<string, unknown>[]; gui_grid_columns?: unknown } };
    expect(node.config.gui_widgets.map((w) => w.id)).toEqual(['a', 'b', 'c']);
    expect(node.config.gui_widgets[0]).toEqual({ id: 'a', kind: 'text', w: 8, h: 2 });
    // 'large' meant 12 of 12 columns; on the placed grid that is rescaled to 16 of 16.
    expect(node.config.gui_widgets[2]).toMatchObject({ w: 16, h: 6 });
    expect(node.config.gui_grid_columns).toBeUndefined();
  });
});

describe('where it runs', () => {
  it('is applied by parseGraph, so every reader gets a current graph', () => {
    const graph = parseGraph({ metadata: { name: 'old' }, nodes: [raw({ node_type: 'text_input', config: {} })], edges: [] });
    expect(graph.nodes[0].node_type).toBe('input');
  });

  it('leaves a current graph exactly as it was', () => {
    const current = { metadata: { name: 'now' }, nodes: [raw({ node_type: 'code', config: { code: 'x' } })], edges: [] };
    expect(migrateGraph(current)).toEqual(current);
  });
});
