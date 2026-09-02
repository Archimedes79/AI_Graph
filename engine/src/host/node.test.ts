import { describe, it, expect } from 'vitest';
import { nodeCode } from './node.ts';

/** What a body that does not run says: one sentence a person can act on. */
describe('the sandbox', () => {
  it('names a syntax error, which Node prints above the stack', async () => {
    await expect(nodeCode.run('def run(inputs):\n    return {}', {})).rejects.toThrow(/SyntaxError/);
  });

  it('names a thrown error, which Node prints below its stack', async () => {
    await expect(nodeCode.run('function run() { throw new Error("boom"); }', {})).rejects.toThrow(/boom/);
  });

  it('returns what the body returned', async () => {
    await expect(nodeCode.run('function run(i) { return { n: i.a + 1 }; }', { a: 1 })).resolves.toEqual({ n: 2 });
  });
});
