import { describe, it, expect } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNode, NodeType, Port } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import type { NodePanelProps } from '@/elements/NodeGuiBuilder';
import { nodeFields } from '@/authoring/generation';
import { withExpect, withInput } from '@/authoring/examplePair';
import CodeNodePanel from './code/CodeNodePanel';
import AiNodePanel from './ai/AiNodePanel';
import DataNodePanel from './data/DataNodePanel';

/**
 * A code, an ai and a data node's dialog, drawn: the four steps, and what each
 * panel decides to put in them.
 *
 * The rules behind them are tested on their own (`nodeStepRules.test.ts`,
 * `examplePair.test.ts`, `ExampleInputField.test.ts`); this is where a panel
 * is held to handing them on -- which a refactor of the panel could otherwise
 * break with every one of those still green. The panels are imported
 * directly, because the builders register them lazily; everything else a
 * panel is handed comes from the builder, as the node dialog hands it.
 */

const PANELS: Partial<Record<NodeType, ComponentType<NodePanelProps>>> = {
  code: CodeNodePanel,
  ai: AiNodePanel,
  data: DataNodePanel,
};

/** What only the node dialog hands a panel in steps; here nothing is run or asked. */
const steps = (node: GraphNode): NonNullable<NodePanelProps['steps']> => ({
  inputs: createElement('div', null, 'the input ports'),
  outputs: createElement('div', null, 'the output ports'),
  preview: createElement('button', null, 'What ✨ sends'),
  sent: null,
  openInEditor: null,
  graph: () => ({ metadata: {} as never, nodes: [node], edges: [] }),
  fromGraph: async () => ({ values: {}, said: '' }),
});

function panel(node: GraphNode): string {
  const builder = NODE_BUILDERS[node.node_type];
  const html = renderToStaticMarkup(createElement(PANELS[node.node_type]!, {
    builder, node, setConfig: () => {}, updateNode: () => {},
    fields: nodeFields(node, () => {}, () => {}), generating: false, onGenerate: () => {},
    steps: steps(node),
  }));
  // A panel draws nothing when it is not handed what it needs: every
  // assertion below would then hold on an empty page.
  expect(html).toContain('aria-label="What comes in"');
  return html;
}

const input = (id: string, multi = false): Port => ({ id, name: id, kind: 'input', data_type: 'any', multi, required: false, description: '' });

/** A new node of *type*, with *config* set on top of what it starts with. */
function made(type: 'code' | 'ai' | 'data', config: Record<string, unknown> = {}, inputs?: Port[]): GraphNode {
  const node = NODE_KINDS[type].create(type);
  return { ...node, inputs: inputs ?? node.inputs, config: { ...node.config, ...config } };
}

/** One example, as the dialog writes it. */
const example = (inputText: string) => withExpect(withInput('', inputText), '{ "output": 1 }');

describe.each([
  ['code', 'Code'],
  ['ai', 'Instructions'],
  ['data', 'Its format'],
] as const)('a %s node, built in the four steps', (type, body) => {
  it('draws the four steps, and both ways to fill its example', () => {
    const html = panel(made(type));
    for (const step of ['What comes in', 'What comes out', body]) expect(html, step).toContain(`aria-label="${step}"`);
    expect(html).toMatch(/aria-label="What (should it do|should it hold)\?"/);
    expect(html).toContain('⟳ From the graph');
    expect(html).toContain('📂 From a file…');
    expect(html).toContain('What ✨ sends');
  });
});

describe.each(['code', 'ai'] as const)('a %s node\'s step 1', (type) => {
  const port = () => made(type).inputs[0].id;

  it('says how many more examples its examples.md keeps after the one shown', () => {
    const one = example(`{ "${port()}": "a" }`);
    expect(panel(made(type, { examples: one }))).not.toContain('more example');
    expect(panel(made(type, { examples: `${one}\n${one}` }))).toContain('holds 1 more example after this one');
  });

  it('asks "Run once per item" only where a list arrives', () => {
    const scalar = [input(port())];
    expect(panel(made(type, { examples: example(`{ "${port()}": "a" }`) }, scalar))).not.toContain('Run once per item');
    // An example that holds a list on the port, and a port declared one. A
    // list wired to the port is `listPorts`' to find (`nodeStepRules.test.ts`):
    // drawn statically, a panel sees the store as it starts, with no wires.
    expect(panel(made(type, { examples: example(`{ "${port()}": ["a", "b"] }`) }, scalar))).toContain('Run once per item');
    expect(panel(made(type, {}, [input(port(), true)]))).toContain('Run once per item');
  });

  it('has no example to fill when it takes nothing in and none was written before', () => {
    const html = panel(made(type, {}, []));
    expect(html).not.toContain('⟳ From the graph');
    expect(html).not.toContain('📂 From a file…');
  });
});

describe('a code and an ai node', () => {
  it('are laid out alike: the same sections in the same order, and only the body differs', () => {
    // Everything but the body's own words, in the order the page draws it.
    const landmarks = (html: string) => [
      'aria-label="What comes in"', 'the input ports', 'Example input', 'aria-label="What comes out"', 'the output ports',
      'What comes out, in words', 'Shape kept from a run', 'aria-label="What should it do?"',
      '>✨ Generate</button>', 'aria-label="Try it"', '▶ Try it', 'aria-label="Judged by a model"',
    ].map((mark) => html.indexOf(mark));
    for (const type of ['code', 'ai'] as const) {
      const at = landmarks(panel(made(type, { examples: example(`{ "${made(type).inputs[0].id}": "a" }`) })));
      expect(at.every((index) => index >= 0), `${type}: ${at}`).toBe(true);
      expect(at, type).toEqual([...at].sort((a, b) => a - b));
    }
  });
});
