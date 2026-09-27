import { describe, expect, it } from 'vitest';
import type { GraphNode, Port } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { parseExamples } from '@engine/execution/examples.ts';
import { readPair, withExpect, withInput } from '@/authoring/examplePair';
import { trackPorts } from '@/store/portRenames';
import { withPorts, withSetting } from './nodeDraft';

/**
 * The node dialog's draft, edited the way its ports editor edits it: a row
 * renamed by spreading it with its new id, removed by filtering it out, a new
 * one appended (`PortsEditor`).
 */
const rename = (ports: Port[], at: number, id: string) => ports.map((port, i) => (i === at ? { ...port, id, name: id } : port));
const remove = (ports: Port[], at: number) => ports.filter((_, i) => i !== at);
const fresh = (id: string): Port => ({ id, name: id, kind: 'input', data_type: 'any', multi: false, required: false, description: '' });

/** A code node with inputs *ids*, its example *example*, opened in the dialog. */
function opened(ids: string[], example: string): GraphNode {
  const node = NODE_KINDS.code.create('worker');
  node.inputs = ids.map(fresh);
  node.config.examples = withInput('', example);
  return trackPorts(node);
}

const inputs = (draft: GraphNode) => readPair(String(draft.config.examples)).input;

describe('the example follows the ports it is keyed by', () => {
  it('renames the value with its port, keystroke by keystroke, so Try it hands the body what it reads', () => {
    // Renamed `input` to `csv` in step 1, the wire followed and the value did
    // not: Try it ran the body with `inputs.csv` undefined.
    let draft = opened(['input'], '{"input": "a,b"}');
    for (const typed of ['inpu', '', 'c', 'cs', 'csv']) draft = withPorts(draft, { inputs: rename(draft.inputs, 0, typed), outputs: draft.outputs });
    expect(inputs(draft)).toEqual({ csv: 'a,b' });
  });

  it('takes the value away with a removed port, and leaves the port that slid into its row alone', () => {
    let draft = opened(['prompt', 'context'], '{"prompt": "p", "context": "c"}');
    draft = withPorts(draft, { inputs: remove(draft.inputs, 0), outputs: draft.outputs });
    expect(inputs(draft)).toEqual({ context: 'c' });
  });

  it('follows a port added in the dialog, which had no name before it', () => {
    let draft = opened(['input'], '{"input": 1}');
    draft = withPorts(draft, { inputs: [...draft.inputs, fresh('input2')], outputs: draft.outputs });
    draft = { ...draft, config: { ...draft.config, examples: withInput(String(draft.config.examples), '{"input": 1, "input2": 2}') } };
    draft = withPorts(draft, { inputs: rename(draft.inputs, 1, 'top'), outputs: draft.outputs });
    expect(inputs(draft)).toEqual({ input: 1, top: 2 });
  });

  it('does not take another port\'s value when a rename is typed through its name', () => {
    // "text2" to "text3" passes "text", which the first port is called.
    let draft = opened(['text', 'text2'], '{"text": "A", "text2": "B"}');
    for (const typed of ['text', 'text3']) draft = withPorts(draft, { inputs: rename(draft.inputs, 1, typed), outputs: draft.outputs });
    expect(inputs(draft)?.text).toBe('A');
  });

  it('renames what an expectation names with its output, in every example `test` runs', () => {
    let draft = opened(['input'], '{"input": 1}');
    draft = { ...draft, config: { ...draft.config, examples: `${withExpect(String(draft.config.examples), '{"output": 2}')}\n## More\n\n\`\`\`json input\n{"input": 3}\n\`\`\`\n\n\`\`\`json expect\n{"output": 4}\n\`\`\`\n` } };
    draft = withPorts(draft, { inputs: rename(draft.inputs, 0, 'n'), outputs: rename(draft.outputs, 0, 'doubled') });
    expect(parseExamples(String(draft.config.examples)).examples).toEqual([
      { title: 'The example', inputs: { n: 1 }, expect: { doubled: 2 } },
      { title: 'More', inputs: { n: 3 }, expect: { doubled: 4 } },
    ]);
  });
});

describe('a setting changed after a wait', () => {
  it('is changed from what the draft holds when it lands, not from a copy taken before', () => {
    // ⟳ From the graph waits on a run upstream. What was typed into step 2
    // meanwhile was put back by the copy of the examples the click had.
    const node = NODE_KINDS.code.create('worker');
    const clicked = withInput('', '{"input": "old"}');
    const draft = { ...node, config: { ...node.config, examples: withExpect(clicked, '{"output": "typed meanwhile"}') } };
    const landed = withSetting(draft, node, 'examples', (current: unknown) => withInput(String(current), '{"input": "from the graph"}'));
    expect(readPair(String(landed.config.examples))).toMatchObject({
      input: { input: 'from the graph' },
      expect: { output: 'typed meanwhile' },
    });
  });
});

describe('catching failures', () => {
  const outputIds = (draft: GraphNode) => draft.outputs.map((port) => port.id);

  it('grows the error output when ticked and takes it away when unticked', () => {
    const node = NODE_KINDS.code.create('worker');
    const ticked = withSetting(node, node, 'catch_errors', true);
    expect(outputIds(ticked)).toEqual([...outputIds(node), 'error']);
    expect(outputIds(withSetting(ticked, ticked, 'catch_errors', false))).toEqual(outputIds(node));
  });
});
