import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { currentTry } from './TryItInline';
import { tryKey } from './nodeStepRules';
import { withExpect, withInput, withJudge } from './examplePair';

/**
 * What a try belongs to. ▶ Try it shows what came out, ✓ holds it to step 2,
 * and Keep keeps it -- and all three described a try of an
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

  it('is still the try after what it only describes changed: the expectation, the judge, the kept shape, the request', () => {
    const node = NODE_KINDS.code.create('c');
    const example = { input: 'a' };
    const key = tryKey(node, example, 'code_prompt');
    const examples = withJudge(withExpect(withInput('', '{"input": "a"}'), '{"output": "A"}'), 'Upper case.');
    const described = { ...node, config: { ...node.config, examples, output_schema: { type: 'object' }, code_prompt: 'Shout it.' } };
    expect(tryKey(described, example, 'code_prompt')).toBe(key);
  });
});
