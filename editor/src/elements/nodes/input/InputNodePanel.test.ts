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
    builder, node, setConfig: () => {}, updateNode: () => {},
    fields: nodeFields(node, () => {}, () => {}), generating: false,
    onGenerate: () => {}, setInvalid: () => {}, steps: { graph: () => ({ metadata: {} as never, nodes: [node], edges: [] }) },
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

  it('offers to show what a file input hands on, and only once there is a file to read', () => {
    // The file it reads is the sample every node after it is shown; the
    // dialog had no way to see what that was.
    const node = NODE_KINDS.input.create('file');
    node.config.input_mode = 'file';
    expect(panel(node)).toMatch(/<button[^>]*disabled=""[^>]*>Show what it hands on<\/button>/);
    node.config.value = 'data/people.csv';
    expect(panel(node)).toMatch(/<button(?![^>]*disabled)[^>]*>Show what it hands on<\/button>/);
    expect(panel(NODE_KINDS.input.create('text'))).not.toContain('Show what it hands on');
  });
});
