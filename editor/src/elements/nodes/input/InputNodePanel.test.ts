import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import { nodeFields } from '@/authoring/generation';
import InputNodePanel from './InputNodePanel';

function panel(node: GraphNode): string {
  const builder = NODE_BUILDERS.input;
  return renderToStaticMarkup(createElement(InputNodePanel, {
    builder, node, setConfig: () => {}, updateNode: () => {}, setDescription: () => {},
    generation: builder.generation, fields: nodeFields(node, () => {}, () => {}), generating: false,
    onGenerate: () => {}, canGenerate: true, applyWidgets: () => {}, setInvalid: () => {}, steps: {},
  }));
}

describe('an input node\'s panel', () => {
  it('keeps a text\'s line breaks: it is edited in a box of several lines', () => {
    const node = NODE_KINDS.input.create('text');
    node.config.value = 'first line\nsecond line';
    const html = panel(node);
    expect(html).toMatch(/<textarea[^>]*aria-label="Text"[^>]*>first line\nsecond line<\/textarea>/);
  });

  it('offers the file types for one file too, which the file browser filters by', () => {
    const node = NODE_KINDS.input.create('file');
    node.config.input_mode = 'file';
    expect(panel(node)).toContain('aria-label="File types"');
  });

  it('attaches no example file of its own, and offers to read one an older version attached', () => {
    const node = NODE_KINDS.input.create('file');
    node.config.input_mode = 'file';
    node.config.example_file = 'data/sample.csv';
    const html = panel(node);
    expect(html).not.toContain('📎');
    expect(html).toContain('An example file was attached here before: data/sample.csv');
    expect(html).toContain('Read this file');
  });
});
