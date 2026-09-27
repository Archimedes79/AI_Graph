import { describe, it, expect } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import type { NodePanelProps } from '@/elements/NodeGuiBuilder';
import CodeNodePanel from './code/CodeNodePanel';
import AiNodePanel from './ai/AiNodePanel';

/**
 * A code and an ai node's panel, drawn: its kind and id, its text, a row per
 * ✨ -- the button, the file it writes, the prompt it is written with -- the
 * files ✨ Input and ✨ Output write from, ▶ Try, and its history. Nothing
 * else: its ports, once per item, failures and the model are folded away under
 * Advanced, which the dialog draws. The heading is the dialog's too.
 *
 * The panels are imported directly, because the builders register them
 * lazily; everything else a panel is handed comes from the builder, as the
 * node dialog hands it. Drawn with no project open, as a new graph is.
 */

const PANELS: Record<'code' | 'ai', ComponentType<NodePanelProps>> = { code: CodeNodePanel, ai: AiNodePanel };

function panel(node: GraphNode): string {
  return renderToStaticMarkup(createElement(PANELS[node.node_type as 'code' | 'ai'], {
    builder: NODE_BUILDERS[node.node_type], node, setConfig: () => {}, updateNode: () => {}, setDescription: () => {},
    generating: false, onGenerate: async () => false,
    shell: { graph: () => ({ metadata: {} as never, nodes: [node], edges: [] }), preview: async () => [], graphFile: async () => undefined, flush: () => {} },
  }));
}

/** A new node of *type*, with *config* set on top of what it starts with. */
function made(type: 'code' | 'ai', config: Record<string, unknown> = {}): GraphNode {
  const node = NODE_KINDS[type].create(type);
  return { ...node, config: { ...node.config, ...config } };
}

describe.each([
  ['code', 'CODE', '✨ Code', 'code.js'],
  ['ai', 'AI', '✨ Prompt', 'prompt.md'],
] as const)('a %s node\'s panel', (type, kind, body, file) => {
  it('is its kind and id, its text, a row per ✨, ▶ Try and its history -- in that order, which is the order Tab takes', () => {
    const html = panel(made(type));
    const at = [
      `>${kind}</span>`, `>${type}</code>`, 'aria-label="What it should do"',
      '>✨ Input</button>', 'input.js ↗', 'aria-label="✨ Input prompt"', 'Example files:', '⟳ From the graph', '📂 Add a file…',
      '>✨ Output</button>', 'output.js ↗', 'aria-label="✨ Output prompt"', 'Output files:',
      `>${body}</button>`, `${file} ↗`, `aria-label="${body} prompt"`,
      '▶ Try', 'history.md ↗',
    ].map((mark) => html.indexOf(mark));
    expect(at.every((index) => index >= 0), String(at)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('draws nothing else: its ports, once per item, failures and its model are under Advanced', () => {
    const html = panel(made(type));
    for (const gone of ['Takes in', 'Hands out', 'Run once per item', 'Catch', 'aria-label="Model"', 'aria-label="input type"', 'Items at once']) {
      expect(html, gone).not.toContain(gone);
    }
  });

  it('shows each prompt, the standard one until it is changed, naming what it is filled with', () => {
    const html = panel(made(type));
    expect(html.match(/The standard prompt/g)).toHaveLength(3);
    expect(html).not.toContain('>Reset</button>');
    expect(html).toContain('{Example Files}');
    expect(html).toContain('{Output Files}');
    const changed = panel(made(type, { prompts: { input: 'Mine, as typed ' } }));
    expect(changed).toContain('Its prompt, changed');
    expect(changed).toContain('>Reset</button>');
    expect(changed).toMatch(/<textarea[^>]*>Mine, as typed <\/textarea>/);
  });

  it('shows each file before it is written: greyed, saying when it will be', () => {
    const html = panel(made(type));
    // Four chips -- input.js, output.js, the body, history.md -- none a file yet in a graph not saved as a project.
    expect(html.match(/written when the graph is saved as a project/g)).toHaveLength(4);
    expect(html.match(/<button[^>]*disabled=""[^>]*aria-label="Open [^"]+"/g)).toHaveLength(4);
  });

  it('gives every button a title that says what it does', () => {
    const html = panel(made(type, { input_files: ['data/people.csv'], output_files: ['spec.md'], prompts: { body: 'Mine.' } }));
    const untitled = (html.match(/<button[^>]*>/g) ?? []).filter((button) => !/ title="[^"]+"/.test(button));
    expect(untitled).toEqual([]);
  });

  it('shows the files ✨ Input and ✨ Output write from, a chip each with ✕ -- and says so where there are none', () => {
    const empty = panel(made(type));
    expect(empty).toContain('none -- it reads the file the graph hands it, where there is one');
    expect(empty).toMatch(/Output files:<\/span><span[^>]*>none<\/span>/);
    const given = panel(made(type, { input_files: ['data/people.csv', 'spec.md'], output_files: ['out/spec.md'] }));
    for (const path of ['data/people.csv', 'spec.md', 'out/spec.md']) expect(given).toContain(`aria-label="Let ${path} go"`);
    // ⟳ takes the file the graph hands the node: an input's, so under ✨ Input alone.
    expect(given.match(/⟳ From the graph/g)).toHaveLength(1);
    expect(given.match(/📂 Add a file…/g)).toHaveLength(2);
  });

  it('says why ▶ Try waits while there is no input.js, and tries a node that takes nothing in', () => {
    expect(panel(made(type))).toContain('Write its input.js first (✨ Input): its example is what it is tried on.');
    expect(panel(made(type, { input_definition: 'module.exports = { "input": "a" };' }))).not.toContain('Write its input.js first');
    expect(panel({ ...made(type), inputs: [] })).not.toContain('Write its input.js first');
  });
});
