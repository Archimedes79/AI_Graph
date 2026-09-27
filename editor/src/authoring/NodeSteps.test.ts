import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import { nodeFields } from './generation';
import { withExpect, withInput } from './examplePair';
import AiNodePanel from '@/elements/nodes/ai/AiNodePanel';
import CodeNodePanel from '@/elements/nodes/code/CodeNodePanel';

/** A node's four steps, drawn as the dialog draws them. */
function drawn(node: GraphNode): string {
  const builder = NODE_BUILDERS[node.node_type];
  const Panel = node.node_type === 'ai' ? AiNodePanel : CodeNodePanel;
  return renderToStaticMarkup(createElement(Panel, {
    builder, node, setConfig: () => {}, updateNode: () => {},
    fields: nodeFields(node, () => {}, () => {}), generating: false,
    onGenerate: () => {}, setInvalid: () => {}, steps: { graph: () => ({ metadata: {} as never, nodes: [node], edges: [] }) },
  }));
}

/** What *html* holds from where step 2 begins to where step 3 begins. */
const step2 = (html: string): string => html.slice(html.indexOf('aria-label="What comes out"'), html.indexOf('aria-label="What should it do?"'));

describe('what the four steps show of the example', () => {
  it('shows the expected output under Try it, for an ai node too -- which `test` holds its answer to -- and lets it be dropped', () => {
    // An ai node's step 2 asked for an answer to imitate, so an expect block
    // from a file written by hand was never shown -- and `test` failed on it.
    const node = NODE_KINDS.ai.create('capital');
    node.config.examples = withExpect(withInput('', '{"prompt": "France?"}'), '{"output": "Paris"}');
    const html = drawn(node);
    expect(html).toContain('Expected: <code>{&quot;output&quot;: &quot;Paris&quot;}</code>');
    expect(html).toContain('aria-label="Drop the expected output"');
    expect(step2(html)).not.toContain('Expected');

    const plain = NODE_KINDS.ai.create('capital');
    plain.config.examples = withInput('', '{"prompt": "France?"}');
    expect(drawn(plain)).not.toContain('Expected:');
  });

  it('says which of the example\'s values no input is called any more', () => {
    const node = NODE_KINDS.code.create('worker');
    node.config.examples = withInput('', '{"input": "a", "csv": "b"}');
    const html = drawn(node);
    expect(html).toContain('It gives “csv”, which no input is called');
    expect(html).not.toContain('“input”, which');
  });
});

describe.each(['code', 'ai'] as const)('a %s node\'s step 2', (type) => {
  it('is what the graph says, one field of words and the kept shape -- no example output, no judge, no ▶ Test of its own', () => {
    const html = step2(drawn(NODE_KINDS[type].create(type)));
    expect(html).toContain('What comes out, in words');
    expect(html).toContain('Shape kept from a run');
    for (const gone of ['Example output', 'Example answer', 'Judged by a model', '▶ Test']) expect(html, gone).not.toContain(gone);
  });

  it('leaves the verdict to Try it: the judge\'s sentence is asked there', () => {
    const html = drawn(NODE_KINDS[type].create(type));
    const tryIt = html.slice(html.indexOf('aria-label="Try it"'));
    expect(tryIt).toContain('▶ Try it');
    expect(tryIt).toContain('aria-label="Judged by a model"');
  });
});
