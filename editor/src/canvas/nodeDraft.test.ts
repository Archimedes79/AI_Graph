import { describe, expect, it } from 'vitest';
import type { GraphNode, Port } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { definitionExample } from '@engine/authoring/definition.ts';
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

/** An input definition of *example*, each key a documented property, as ✨ Input writes one. */
const defined = (example: Record<string, unknown>) => `/**
 * @typedef {Object} Input
${Object.keys(example).map((key) => ` * @property {string} ${key} What arrives on ${key}`).join('\n')}
 */
module.exports = ${JSON.stringify(example, null, 2)};
`;

/** A code node with inputs *ids* and an input definition of *example*, opened in the dialog. */
function opened(ids: string[], example: Record<string, unknown>): GraphNode {
  const node = NODE_KINDS.code.create('worker');
  node.inputs = ids.map(fresh);
  node.config.input_definition = defined(example);
  return trackPorts(node);
}

const inputs = (draft: GraphNode) => {
  const read = definitionExample(String(draft.config.input_definition));
  return 'example' in read ? read.example : undefined;
};

describe('the definitions follow the ports they are keyed by', () => {
  it('renames the key with its port, keystroke by keystroke, so ▶ Try hands the body what it reads', () => {
    let draft = opened(['input'], { input: 'a,b' });
    // An empty name, or one another port has, is never handed on: the ports editor keeps it as typed (`portIdProblems`).
    for (const typed of ['inpu', 'c', 'cs', 'csv']) draft = withPorts(draft, { inputs: rename(draft.inputs, 0, typed), outputs: draft.outputs });
    expect(inputs(draft)).toEqual({ csv: 'a,b' });
    // The documented property follows the key.
    expect(String(draft.config.input_definition)).toContain('@property {string} csv What arrives on input');
  });

  it('takes the key and its property away with a removed port, and leaves the port that slid into its row alone', () => {
    let draft = opened(['prompt', 'context'], { prompt: 'p', context: 'c' });
    draft = withPorts(draft, { inputs: remove(draft.inputs, 0), outputs: draft.outputs });
    expect(inputs(draft)).toEqual({ context: 'c' });
    expect(String(draft.config.input_definition)).not.toContain('prompt');
  });

  it('renames an output\'s key in output.js with the output', () => {
    let draft = opened(['input'], { input: 1 });
    draft = { ...draft, config: { ...draft.config, output_definition: 'module.exports = { "output": 2 };' } };
    draft = withPorts(draft, { inputs: draft.inputs, outputs: rename(draft.outputs, 0, 'doubled') });
    const read = definitionExample(String(draft.config.output_definition));
    expect('example' in read && read.example).toEqual({ doubled: 2 });
  });

  it('leaves a stub alone: there is no key in it to follow', () => {
    let draft = opened(['input'], { input: 1 });
    draft = { ...draft, config: { ...draft.config, input_definition: 'module.exports = null;' } };
    draft = withPorts(draft, { inputs: rename(draft.inputs, 0, 'csv'), outputs: draft.outputs });
    expect(draft.config.input_definition).toBe('module.exports = null;');
  });
});

describe('a setting changed after a wait', () => {
  it('is changed from what the draft holds when it lands, not from a copy taken before', () => {
    // A file taken for ✨ Input lands after the path is looked for; one added meanwhile stays.
    const node = NODE_KINDS.code.create('worker');
    const draft = { ...node, config: { ...node.config, input_files: ['added meanwhile.csv'] } };
    const landed = withSetting(draft, 'input_files', (current: unknown) => [...(current as string[]), 'dropped.csv']);
    expect(landed.config.input_files).toEqual(['added meanwhile.csv', 'dropped.csv']);
  });
});

describe('catching failures', () => {
  const outputIds = (draft: GraphNode) => draft.outputs.map((port) => port.id);

  it('grows the error output when ticked and takes it away when unticked', () => {
    const node = NODE_KINDS.code.create('worker');
    const ticked = withSetting(node, 'catch_errors', true);
    expect(outputIds(ticked)).toEqual([...outputIds(node), 'error']);
    expect(outputIds(withSetting(ticked, 'catch_errors', false))).toEqual(outputIds(node));
  });
});
