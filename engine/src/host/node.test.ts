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

describe('a body that asks the process holding the graph', () => {
  it('is handed its node: plain data, and questions it may ask', async () => {
    const asked: unknown[] = [];
    const out = await nodeCode.run(
      'async function run(inputs, node) { return { sum: await node.add({ a: inputs.a, b: node.offset }), twice: await node.add({ a: 1, b: 1 }) }; }',
      { a: 2 },
      undefined,
      { data: { offset: 40 }, calls: { add: async (args) => { asked.push(args); const { a, b } = args as { a: number; b: number }; return a + b; } } },
    );
    expect(out).toEqual({ sum: 42, twice: 2 });
    expect(asked).toEqual([{ a: 2, b: 40 }, { a: 1, b: 1 }]);
  });

  it('gets a refusal as an error it can catch, or fail on', async () => {
    const calls = { llm: async () => { throw new Error('no key configured'); } };
    const caught = await nodeCode.run(
      'async function run(i, node) { try { await node.llm({}); } catch (e) { return { said: e.message }; } }', {}, undefined, { calls });
    expect(caught).toEqual({ said: 'no key configured' });
    await expect(nodeCode.run('async function run(i, node) { return { v: await node.llm({}) }; }', {}, undefined, { calls }))
      .rejects.toThrow(/no key configured/);
  });

  it('has nothing to ask when it was offered nothing', async () => {
    const out = await nodeCode.run('function run(i, node) { return { has: typeof node.llm, keys: Object.keys(node) }; }', {});
    expect(out).toEqual({ has: 'undefined', keys: [] });
  });

  it('may print what it likes: only the marked line is its result', async () => {
    const out = await nodeCode.run('function run() { console.log("{\\"not\\": \\"this\\"}"); setTimeout(() => console.log("late"), 5); return { ok: true }; }', {});
    expect(out).toEqual({ ok: true });
  });

  it('asks several things at once and gets each its own answer', async () => {
    const calls = { slow: async (args: unknown) => { const n = Number(args); await new Promise((r) => setTimeout(r, 30 - n * 10)); return n * 10; } };
    const out = await nodeCode.run('async function run(i, node) { return { all: await Promise.all([node.slow(1), node.slow(2)]) }; }', {}, undefined, { calls });
    expect(out).toEqual({ all: [10, 20] });
  });
});

describe('a body that does not keep to the protocol', () => {
  it('may leave a line unfinished before its result', async () => {
    const out = await nodeCode.run('function run() { process.stdout.write("progress 100%"); return { ok: 1 }; }', {});
    expect(out).toEqual({ ok: 1 });
  });

  it('may leave a line unfinished before it asks', async () => {
    const body = 'async function run(i, node) { process.stdout.write("asking..."); return { a: await node.llm({ prompt: "x" }) }; }';
    const out = await nodeCode.run(body, {}, undefined, { calls: { llm: async () => 'hi' } });
    expect(out).toEqual({ a: 'hi' });
  });

  it('is told that a function is not a result, and this process stays up', async () => {
    await expect(nodeCode.run('function run() { return () => 1; }', {})).rejects.toThrow(/must return an object/);
  });

  it('fails, and only itself, when it writes the engine\'s mark', async () => {
    const body = 'function run() { console.log("\\u001eai-graph:result {not json"); return { ok: 1 }; }';
    await expect(nodeCode.run(body, {})).rejects.toThrow(/only the engine may write/);
  });

  it('is not waited for once it has said what it made', async () => {
    const started = Date.now();
    const out = await nodeCode.run('function run() { setInterval(() => {}, 1000); return { ok: 1 }; }', {});
    expect(out).toEqual({ ok: 1 });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('ends when its run never settles, though it could have asked', async () => {
    const body = 'function run() { return new Promise(() => {}); }';
    await expect(nodeCode.run(body, {}, undefined, { calls: { llm: async () => 'x' } })).rejects.toThrow();
  });
});
