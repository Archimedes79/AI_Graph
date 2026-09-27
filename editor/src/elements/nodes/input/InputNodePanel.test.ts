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
    onGenerate: async () => false, steps: { graph: () => ({ metadata: {} as never, nodes: [node], edges: [] }) },
  }));
}

describe('an input node\'s panel', () => {
  it('keeps a text\'s line breaks: it is edited in a box of several lines', () => {
    const node = NODE_KINDS.input.create('text');
    node.config.value = 'first line\nsecond line';
    const html = panel(node);
    expect(html).toMatch(/<textarea[^>]*aria-label="Text"[^>]*>first line\nsecond line<\/textarea>/);
  });

  it('is a text or a folder, and reads no file: a path is a text for the node that reads it', () => {
    // It had a third mode that read one file. Reading is the reading node's
    // own input now, so a text here holds the path and says so.
    const html = panel(NODE_KINDS.input.create('text'));
    expect(html).toMatch(/<select[^>]*aria-label="Mode"[^>]*><option value="text"[^>]*>Text<\/option><option value="directory">Folder \(list of files\)<\/option><\/select>/);
    expect(html).not.toMatch(/value="file"|Single file|Show what it hands on/);
    expect(html).toContain('A file&#x27;s path is a text too');
    // Nothing to list, catch or filter in a text.
    expect(html).not.toContain('aria-label="File types"');
    expect(html).not.toContain('Catch a failed');
  });

  it('is, for a folder, the folder, its file types and its subfolders, and then the list -- no code to write', () => {
    const node = NODE_KINDS.input.create('folder');
    node.config.input_mode = 'directory';
    expect(panel(node)).toMatch(/<button[^>]*disabled=""[^>]*>Show the files it lists<\/button>/);
    node.config.value = 'data/stories';
    const html = panel(node);
    expect(html).toContain('aria-label="Directory"');
    expect(html).toContain('aria-label="File types"');
    expect(html).toContain('Look into subfolders too');
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Show the files it lists<\/button>/);
    // Choosing some of the files is a code node after it, said in one line.
    expect(html).toContain('To use only some of them, wire a code node after it');
    expect(html).not.toContain('✨');
    expect(html).not.toContain('Every file it lists');
  });
});
