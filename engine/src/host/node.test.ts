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

  it('counts the lines as the body was written, not as the wrapper runs it', async () => {
    // The traceback names a temp file that is deleted before anyone reads the
    // message, at a line the wrapper above the body moved.
    const failed = await nodeCode.run('function run() {\n  throw new Error("boom");\n}', {}).catch((error: Error) => error);
    expect((failed as Error).message).not.toMatch(/body\.mjs/);
    expect((failed as Error).message).toMatch(/line 2/);
  });

  it('returns what the body returned', async () => {
    await expect(nodeCode.run('function run(i) { return { n: i.a + 1 }; }', { a: 1 })).resolves.toEqual({ n: 2 });
  });
});
