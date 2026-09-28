import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeCode, nodeFiles, nodeRuntime } from './node.ts';
import { aiSetting } from '../ai/settings.ts';

describe('writing a file', () => {
  it('makes the folders it goes into, as an output writing into a new folder needs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-write-'));
    try {
      const path = join(dir, 'results', 'by country', 'items_1.txt');
      await nodeFiles.write(path, 'alpha');
      expect(await readFile(path, 'utf8')).toBe('alpha');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('removes a file an earlier run left, and does nothing where there is none', async () => {
    // What an output writing into a folder clears of its earlier run's files.
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-remove-'));
    try {
      const path = join(dir, 'value_2.txt');
      await nodeFiles.write(path, 'last run');
      await nodeFiles.remove!(path);
      expect(await nodeFiles.exists(path)).toBe(false);
      await nodeFiles.remove!(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

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
  it('is handed its node: the questions it may ask', async () => {
    const asked: unknown[] = [];
    const out = await nodeCode.run(
      'async function run(inputs, node) { return { sum: await node.add({ a: inputs.a, b: 40 }), twice: await node.add({ a: 1, b: 1 }) }; }',
      { a: 2 },
      undefined,
      { calls: { add: async (args) => { asked.push(args); const { a, b } = args as { a: number; b: number }; return a + b; } } },
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

/**
 * The one AI setting is read once, by `aiSetting`, and a call is sent where
 * it says -- or where the node pins. The provider layer used to read the
 * setting's model again and hand it to a provider the setting had not chosen.
 */
describe('where a model call goes', () => {
  it('does not hand a provider a node pins, with no model named, the model the one AI setting names for another', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-one-setting-'));
    const file = join(dir, 'ai-settings.json');
    // A model and no provider: the provider is the local one that answers -- LM Studio, here -- and the model is its.
    await writeFile(file, JSON.stringify({ ai: { model: 'the-settings-model' } }));
    for (const [name, value] of Object.entries({ AI_GRAPH_SETTINGS: file, AI_GRAPH_AI_PROVIDER: '', AI_GRAPH_AI_MODEL: '', OLLAMA_BASE_URL: '', LMSTUDIO_BASE_URL: '' })) {
      vi.stubEnv(name, value);
    }
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(String(url));
      if (String(url).endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'loaded' }] }));
      throw new Error(`nothing answers at ${url}`);
    });
    try {
      expect(await aiSetting()).toEqual({ provider: 'lmstudio', model: 'the-settings-model' });
      await expect(nodeRuntime().ai.complete({ prompt: 'x', provider: 'ollama' })).rejects.toThrow("No model configured for provider 'ollama'");
      expect(asked.filter((url) => url.includes('/api/chat'))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
