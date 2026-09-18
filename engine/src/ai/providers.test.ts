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

/**
 * A calculator, and a record of what it was asked.
 *
 * The provider layer is handed tools this way -- specs and a function -- and
 * knows nothing of where they live, so neither does the test.
 */
function calculator() {
  const asked: { name: string; args: Record<string, unknown> }[] = [];
  return {
    asked,
    specs: [{
      name: 'add',
      description: 'Add two numbers.',
      parameters: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        // A parameter that happens to be *called* `$id` is not schema noise.
        properties: { a: { type: 'number', $comment: 'first' }, b: { type: 'number' }, $id: { type: 'string' } },
        required: ['a', 'b'],
      },
    }],
    async call(name: string, args: Record<string, unknown>) {
      asked.push({ name, args });
      return String((args.a as number) + (args.b as number));
    },
  };
}

describe('the tool loop, in OpenAI\'s dialect', () => {
  // As Gemini 3 sends it through the OpenAI-compatible endpoint: a thought
  // signature on the call, which it wants back on the next turn.
  const toolCall = {
    id: 'call_1',
    type: 'function',
    function: { name: 'add', arguments: '{"a":2,"b":3}' },
    extra_content: { google: { thought_signature: 'sig-abc' } },
  };
  const asksForAdd = { body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [toolCall] } }] } };

  it('offers the tools, runs the call, and answers with what the model says next', async () => {
    const calls = stubFetch([asksForAdd, openAiReply('It is 5.')]);
    const tools = calculator();
    const ai = aiService({ provider: 'lmstudio', model: 'local' });

    expect(await ai.complete({ prompt: 'what is 2+3?', tools })).toBe('It is 5.');
    expect(tools.asked).toEqual([{ name: 'add', args: { a: 2, b: 3 } }]);

    expect(calls).toHaveLength(2);
    expect(calls[0].body.tools).toEqual([{
      type: 'function',
      function: {
        name: 'add',
        description: 'Add two numbers.',
        parameters: {
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'number' }, $id: { type: 'string' } },
          required: ['a', 'b'],
        },
      },
    }]);
  });

  it('echoes the assistant message exactly, signature and all, then the result', async () => {
    // Rebuilt from the fields understood here, the message loses the one that
    // is not -- and Gemini 3 answers the second turn with a 400.
    const calls = stubFetch([asksForAdd, openAiReply('5')]);
    const ai = aiService({ provider: 'google', model: 'gemini-3', apiKeys: { google: 'k' } });

    await ai.complete({ prompt: 'what is 2+3?', system: 'be brief', tools: calculator() });

    expect(calls[1].body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'what is 2+3?' },
      { role: 'assistant', content: null, tool_calls: [toolCall] },
      { role: 'tool', tool_call_id: 'call_1', content: '5' },
    ]);
  });

  it('tells the model its arguments were not JSON, instead of failing the run', async () => {
    const broken = { ...toolCall, function: { name: 'add', arguments: '{"a": 2, "b":' } };
    const calls = stubFetch([
      { body: { choices: [{ message: { role: 'assistant', content: '', tool_calls: [broken] } }] } },
      openAiReply('Sorry, let me just say 5.'),
    ]);
    const tools = calculator();
    const ai = aiService({ provider: 'lmstudio', model: 'local' });

    expect(await ai.complete({ prompt: 'x', tools })).toBe('Sorry, let me just say 5.');
    expect(tools.asked).toEqual([]);
    expect(calls[1].body.messages.at(-1).content).toMatch(/^Tool error: the arguments were not valid JSON/);
  });

  it('reads no arguments at all as none, and a tool it never offered as a mistake to report', async () => {
    const tools = {
      specs: [{ name: 'ping', description: '', parameters: {} }],
      call: vi.fn(async (_name: string, _args: Record<string, unknown>) => 'pong'),
    };
    const calls = stubFetch([
      { body: { choices: [{ message: { content: null, tool_calls: [
        { id: 'a', type: 'function', function: { name: 'ping', arguments: '' } },
        { id: 'b', type: 'function', function: { name: 'rm_rf', arguments: '{}' } },
      ] } }] } },
      openAiReply('done'),
    ]);
    const ai = aiService({ provider: 'lmstudio', model: 'local' });

    await ai.complete({ prompt: 'x', tools });

    expect(tools.call).toHaveBeenCalledTimes(1);
    expect(tools.call).toHaveBeenCalledWith('ping', {});
    // A schema-less tool still gets the object schema every provider insists on.
    expect(calls[0].body.tools[0].function.parameters).toEqual({ type: 'object', properties: {} });
    const [first, second] = calls[1].body.messages.slice(-2);
    expect(first).toEqual({ role: 'tool', tool_call_id: 'a', content: 'pong' });
    expect(second.content).toMatch(/^Tool error: there is no tool named "rm_rf"/);
  });

  it('stops after eight rounds and asks for an answer with the tools withdrawn', async () => {
    const calls = stubFetch([...Array(8).fill(asksForAdd), openAiReply('From what I have: 5.')]);
    const tools = calculator();
    const ai = aiService({ provider: 'lmstudio', model: 'local' });

    expect(await ai.complete({ prompt: 'x', tools })).toBe('From what I have: 5.');
    expect(tools.asked).toHaveLength(8);
    expect(calls).toHaveLength(9);
    expect(calls[7].body.tool_choice).toBeUndefined();
    expect(calls[8].body.tool_choice).toBe('none');
    expect(calls[8].body.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringMatching(/Do not call any more tools/) });
  });

  it('gives up, clearly, on a model that will not stop calling', async () => {
    stubFetch([asksForAdd]);
    const ai = aiService({ provider: 'lmstudio', model: 'local', retryDelay: 0 });
    await expect(ai.complete({ prompt: 'x', tools: calculator() })).rejects.toThrow(/still calling tools after 8 rounds/);
  });

  it('retries one empty turn, not the conversation -- a tool is not run twice', async () => {
    const calls = stubFetch([asksForAdd, openAiReply(''), openAiReply('5')]);
    const tools = calculator();
    const ai = aiService({ provider: 'lmstudio', model: 'local', retryDelay: 0 });

    expect(await ai.complete({ prompt: 'x', tools })).toBe('5');
    expect(tools.asked).toHaveLength(1);
    // The retry asked the same thing: the empty answer never entered the history.
    expect(calls[2].body.messages).toEqual(calls[1].body.messages);
  });

  it('fails the node when the tool server itself fails', async () => {
    // What a tool *returns* is the model's to deal with. A tool service that
    // throws has stopped existing, and an answer written without it should
    // not pass for one written with it.
    stubFetch([asksForAdd, openAiReply('never reached')]);
    const tools = { ...calculator(), call: async () => { throw new Error('the server exited'); } };
    const ai = aiService({ provider: 'lmstudio', model: 'local' });
    await expect(ai.complete({ prompt: 'x', tools })).rejects.toThrow(/the server exited/);
  });

  it('sends the request it always sent when the tool list is empty', async () => {
    const calls = stubFetch([openAiReply('plain')]);
    const ai = aiService({ provider: 'lmstudio', model: 'local' });

    await ai.complete({ prompt: 'x', tools: { specs: [], call: async () => '' } });
    expect(Object.keys(calls[0].body)).toEqual(['model', 'messages', 'temperature', 'max_tokens']);
  });
});

describe('the tool loop, in the other two dialects', () => {
  it('anthropic: tool_use blocks out, tool_result blocks back in a user message', async () => {
    const blocks = [
      { type: 'thinking', thinking: 'I should add.', signature: 'sig' },
      { type: 'text', text: 'Let me add those.' },
      { type: 'tool_use', id: 'toolu_1', name: 'add', input: { a: 2, b: 3 } },
    ];
    const calls = stubFetch([
      { body: { stop_reason: 'tool_use', content: blocks } },
      { body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'It is 5.' }] } },
    ]);
    const tools = calculator();
    const ai = aiService({ provider: 'anthropic', model: 'claude', apiKeys: { anthropic: 'k' } });

    // The words beside the call are the model thinking aloud, not the answer.
    expect(await ai.complete({ prompt: 'what is 2+3?', tools })).toBe('It is 5.');
    expect(tools.asked).toEqual([{ name: 'add', args: { a: 2, b: 3 } }]);

    expect(calls[0].body.tools[0]).toMatchObject({ name: 'add', description: 'Add two numbers.' });
    expect(calls[0].body.tools[0].input_schema.$schema).toBeUndefined();
    expect(calls[0].body.tools[0].input_schema.required).toEqual(['a', 'b']);
    expect(calls[1].body.messages).toEqual([
      { role: 'user', content: 'what is 2+3?' },
      { role: 'assistant', content: blocks },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '5' }] },
    ]);
  });

  it('anthropic: marks a failed tool as one, and keeps `tools` on the last turn', async () => {
    const asks = { body: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'add', input: {} }] } };
    const calls = stubFetch([...Array(8).fill(asks), { body: { content: [{ type: 'text', text: 'no idea' }] } }]);
    const tools = { ...calculator(), call: async () => 'Tool error: a and b are required' };
    const ai = aiService({ provider: 'anthropic', model: 'claude', apiKeys: { anthropic: 'k' } });

    expect(await ai.complete({ prompt: 'x', tools })).toBe('no idea');
    expect(calls[1].body.messages[2].content[0]).toEqual({
      type: 'tool_result', tool_use_id: 'toolu_1', content: 'Tool error: a and b are required', is_error: true,
    });
    // Anthropic refuses a history of tool_use blocks with no `tools` beside it.
    expect(calls[8].body.tools).toHaveLength(1);
    expect(calls[8].body.tool_choice).toEqual({ type: 'none' });
  });

  it('ollama: arguments arrive as an object, and the result goes back by tool name', async () => {
    const message = {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'add', arguments: { a: 2, b: 3 } } }],
    };
    const calls = stubFetch([{ body: { message } }, { body: { message: { content: 'It is 5.' } } }]);
    const tools = calculator();
    const ai = aiService({ provider: 'ollama', model: 'llama' });

    expect(await ai.complete({ prompt: 'what is 2+3?', system: 'be brief', tools })).toBe('It is 5.');
    expect(tools.asked).toEqual([{ name: 'add', args: { a: 2, b: 3 } }]);

    expect(calls[0].body.tools[0].type).toBe('function');
    expect(calls[0].body.tools[0].function.name).toBe('add');
    expect(calls[0].body.stream).toBe(false);
    expect(calls[1].body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'what is 2+3?' },
      message,
      { role: 'tool', content: '5', tool_name: 'add' },
    ]);
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

describe('a model that thinks its budget away', () => {
  it('is reported once, as what it is, instead of being retried for the same nothing', async () => {
    let asked = 0;
    vi.stubGlobal('fetch', async () => {
      asked += 1;
      return new Response(JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'Let me think about this. '.repeat(40) } }],
      }), { status: 200 });
    });
    const ai = aiService({ provider: 'lmstudio', model: 'thinker', retryDelay: 0, maxTokens: 512 });
    await expect(ai.complete({ prompt: 'Summarize.' })).rejects.toThrow(/whole budget of 512 tokens thinking/);
    expect(asked).toBe(1);
    vi.unstubAllGlobals();
  });
});
