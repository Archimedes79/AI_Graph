import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { currentTry } from './TryItInline';
import { tryKey } from './nodeStepRules';
import { blockTryKey } from './blockStepRules';
import { withExpect, withInput, withJudge } from './examplePair';

/**
 * What a try belongs to. ▶ Try it shows what came out, ✓ holds it to step 2,
 * and "Keep this result" keeps it -- and all three described a try of an
 * older example or body once either had changed since ▶ was pressed.
 */
describe('a try, once what it tried has changed', () => {
  it('is no longer shown, kept or checked (B32)', () => {
    const held = { of: 'before', value: 'what came out' };
    expect(currentTry(held, 'before')).toBe('what came out');
    expect(currentTry(held, 'after')).toBeNull();
    expect(currentTry(null, 'before')).toBeNull();
  });

  it('belongs to a node\'s body, settings, ports and example input', () => {
    const node = NODE_KINDS.code.create('c');
    const example = { input: 'a' };
    const key = tryKey(node, example, 'code_prompt');
    expect(tryKey({ ...node, config: { ...node.config, code: 'function run() { return {}; }' } }, example, 'code_prompt')).not.toBe(key);
    expect(tryKey(node, { input: 'b' }, 'code_prompt')).not.toBe(key);
    expect(tryKey({ ...node, outputs: [] }, example, 'code_prompt')).not.toBe(key);
  });

  it('is still the try after what it only describes changed: the expectation, the judge, what Keep keeps, the request', () => {
    const node = NODE_KINDS.code.create('c');
    const example = { input: 'a' };
    const key = tryKey(node, example, 'code_prompt');
    const examples = withJudge(withExpect(withInput('', '{"input": "a"}'), '{"output": "A"}'), 'Upper case.');
    const described = { ...node, config: { ...node.config, examples, output_example: 'A', output_schema: { type: 'object' }, code_prompt: 'Shout it.' } };
    expect(tryKey(described, example, 'code_prompt')).toBe(key);
  });

  it('of one block is not a try of the next block selected, however alike (B33)', () => {
    const table = WIDGET_BUILDERS.table.create('Rows');
    const one = { ...table, id: 'one', code: 'function run(i) { return i; }' };
    const two = { ...one, id: 'two' };
    const example = { value: [1] };
    expect(blockTryKey(one, example)).not.toBe(blockTryKey(two, example));
    expect(blockTryKey({ ...one, code: '' }, example)).not.toBe(blockTryKey(one, example));
    expect(blockTryKey(one, { value: [2] })).not.toBe(blockTryKey(one, example));
    expect(blockTryKey({ ...one, label: 'Renamed', w: 4, h: 9 }, example)).toBe(blockTryKey(one, example));
  });
});
