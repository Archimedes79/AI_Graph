import { describe, it, expect, vi, afterEach } from 'vitest';
import { aiService, EmptyCompletionError, settingsFromEnv } from './providers.ts';

/** A stand-in for the network: what was asked, and what to answer. */
function stubFetch(replies: (
  { status?: number; body: unknown } | (() => { status?: number; body: unknown })
)[]) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  let index = 0;
  const fetchStub = vi.fn(async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const reply = replies[Math.min(index++, replies.length - 1)];
    const { status = 200, body } = typeof reply === 'function' ? reply() : reply;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

const openAiReply = (text: string) => ({ body: { choices: [{ message: { content: text } }] } });

describe('the OpenAI-style providers', () => {
  it('send system and user as messages, and read the answer back', async () => {
    const calls = stubFetch([openAiReply('the answer')]);
    const ai = aiService({ provider: 'lmstudio', model: 'local' });

    const text = await ai.complete({ prompt: 'the question', system: 'be brief' });

    expect(text).toBe('the answer');
    expect(calls[0].url).toBe('http://localhost:1234/v1/chat/completions');
    expect(calls[0].body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'the question' },
    ]);
  });

  it('refuses before the request when a required key is missing', async () => {
    // Better than a 401 out of the provider, which reads like a broken URL.
    stubFetch([openAiReply('never asked')]);
    const ai = aiService({ provider: 'openai', model: 'gpt-x' });
    await expect(ai.complete({ prompt: 'x' })).rejects.toThrow(/No OpenAI API key/);
  });

  it('says which endpoint is missing rather than posting to nowhere', async () => {
    stubFetch([openAiReply('never asked')]);
    const ai = aiService({ provider: 'openai_compatible', model: 'm' });
    await expect(ai.complete({ prompt: 'x' })).rejects.toThrow(/OpenAI-compatible endpoint/);
  });

  it('will not call with no model, because the 404 that follows misleads', async () => {
    stubFetch([openAiReply('never asked')]);
    const ai = aiService({ provider: 'lmstudio', model: '' });
    await expect(ai.complete({ prompt: 'x' })).rejects.toThrow(/No model configured/);
  });
});

describe('anthropic and ollama, which do not fit the table', () => {
  it('sends anthropic its own shape: system beside the messages, key in a header', async () => {
    const calls = stubFetch([{ body: { content: [{ text: 'hello' }] } }]);
    const ai = aiService({ provider: 'anthropic', model: 'claude', apiKeys: { anthropic: 'k' } });

    expect(await ai.complete({ prompt: 'hi', system: 'be brief' })).toBe('hello');
    expect(calls[0].body.system).toBe('be brief');
    expect(calls[0].headers['x-api-key']).toBe('k');
  });

  it('asks ollama not to stream, and reads message.content', async () => {
    const calls = stubFetch([{ body: { message: { content: 'hi there' } } }]);
    const ai = aiService({ provider: 'ollama', model: 'llama' });

    expect(await ai.complete({ prompt: 'hi' })).toBe('hi there');
    expect(calls[0].body.stream).toBe(false);
  });
});

describe('retrying', () => {
  it('treats an empty completion as worth another go', async () => {
    // The request succeeded and the body was well-formed; the text was "". A
    // local model does this under load, and counted as success it becomes an
    // empty output that everything downstream quietly runs with.
    const calls = stubFetch([openAiReply('   '), openAiReply('second time')]);
    const ai = aiService({ provider: 'lmstudio', model: 'local', retryDelay: 0 });

    expect(await ai.complete({ prompt: 'x' })).toBe('second time');
    expect(calls).toHaveLength(2);
  });

  it('gives up on an empty answer once the attempts are spent', async () => {
    stubFetch([openAiReply('')]);
    const ai = aiService({ provider: 'lmstudio', model: 'local', retryDelay: 0, attempts: 2 });
    await expect(ai.complete({ prompt: 'x' })).rejects.toBeInstanceOf(EmptyCompletionError);
  });

  it('retries a 503 and not a 400', async () => {
    // A 400 is a configuration mistake; retrying it only makes the wait longer.
    const busy = stubFetch([{ status: 503, body: { error: 'busy' } }, openAiReply('ok')]);
    const ai = aiService({ provider: 'lmstudio', model: 'local', retryDelay: 0 });
    expect(await ai.complete({ prompt: 'x' })).toBe('ok');
    expect(busy).toHaveLength(2);

    vi.unstubAllGlobals();
    const bad = stubFetch([{ status: 400, body: { error: { message: 'model not found' } } }]);
    const ai2 = aiService({ provider: 'lmstudio', model: 'local', retryDelay: 0 });
    await expect(ai2.complete({ prompt: 'x' })).rejects.toThrow(/model not found/);
    expect(bad).toHaveLength(1);
  });
});

describe('settingsFromEnv', () => {
  it('picks up only what is set, so defaults survive', () => {
    const settings = settingsFromEnv({ OPENAI_API_KEY: 'k', OLLAMA_BASE_URL: 'http://box:11434' });
    expect(settings.apiKeys).toEqual({ openai: 'k' });
    expect(settings.endpoints).toEqual({ ollama: 'http://box:11434' });
    expect(settings.provider).toBeUndefined();
  });
});
