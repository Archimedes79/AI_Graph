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
    onGenerate: () => {}, setInvalid: () => {}, steps: {},
  }));
}

describe('what the four steps show of the example', () => {
  it('shows an ai node\'s expectation, which `test` holds its answer to, and lets it be dropped', () => {
    // Its step 2 asks for an answer to imitate, so an expect block from a
    // file written by hand was never shown -- and `test` failed on it.
    const node = NODE_KINDS.ai.create('capital');
    node.config.examples = withExpect(withInput('', '{"prompt": "France?"}'), '{"output": "Paris"}');
    const html = drawn(node);
    expect(html).toContain('also compares the answer to this');
    expect(html).toContain('{&quot;output&quot;: &quot;Paris&quot;}');
    expect(html).toContain('aria-label="Drop the expected output"');
    // And ▶ Test, which checks it as `test` does.
    expect(html).toContain('▶ Test the example as test does');

    const plain = NODE_KINDS.ai.create('capital');
    plain.config.examples = withInput('', '{"prompt": "France?"}');
    expect(drawn(plain)).not.toContain('also compares the answer to this');
  });

  it('says which of the example\'s values no input is called any more', () => {
    const node = NODE_KINDS.code.create('worker');
    node.config.examples = withInput('', '{"input": "a", "csv": "b"}');
    const html = drawn(node);
    expect(html).toContain('It gives “csv”, which no input is called');
    expect(html).not.toContain('“input”, which');
  });
});
