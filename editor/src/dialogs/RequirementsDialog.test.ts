import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseGraph } from '@engine/graph.ts';
import { registry } from '@engine/elements/registry.ts';
import { runtimeRequirements } from '@engine/execution/runtimeValues.ts';
import RequirementsDialog, { browsesFor } from './RequirementsDialog';

// A modal is drawn through a portal in the browser; here, in place.
vi.mock('@/ui/Modal', () => ({
  default: ({ children, footer }: { children: unknown; footer: unknown }) => createElement('div', null, children as never, footer as never),
}));

describe('Before running…', () => {
  it('browses for a file an output writes as one to save, which may not exist yet', () => {
    // It opened a browser that picks existing files only, so a new file's
    // name could only be typed.
    expect(browsesFor({ kind: 'file', direction: 'output' })).toBe('save');
    expect(browsesFor({ kind: 'file', direction: 'input' })).toBe('file');
    expect(browsesFor({ kind: 'directory', direction: 'output' })).toBe('directory');
    expect(browsesFor({ kind: 'directory', direction: 'input' })).toBe('directory');
  });

  it('offers the file browser for a text asked for when it is the path of a file to read', () => {
    // A tool without a page names its file with a text input set to ask, wired
    // into the input that reads the file. It was asked for in a bare text box.
    const graph = parseGraph({
      nodes: [
        { id: 'paper', node_type: 'input', label: 'Manuscript', config: { input_mode: 'text', value: 'examples/data/paper/sample_paper.md', prompt_at_runtime: true } },
        { id: 'count', node_type: 'code', inputs: [{ id: 'text', name: 'Text', kind: 'input', data_type: 'file_path', multi: false, required: false, description: '' }], config: {} },
      ],
      edges: [{ id: 'e', source_node_id: 'paper', source_port_id: 'output', target_node_id: 'count', target_port_id: 'text' }],
    });
    const html = renderToStaticMarkup(createElement(RequirementsDialog, {
      requirements: runtimeRequirements(graph, registry), onSubmit: () => {}, onCancel: () => {},
    }));
    expect(html).toContain('Read file for &quot;Manuscript&quot;');
    expect(html).toContain('📂 Browse…');
  });
});
