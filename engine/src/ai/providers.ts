// Talking to a model.
//
// Most providers speak the OpenAI chat-completions shape, so they are a table
// rather than five copies of the same twenty lines: where to POST, which
// credential to send, and whether that credential is mandatory. A sixth such
// provider is one entry — and a fix to the request shape cannot be applied to
// three of them and forgotten on the fourth.
//
// Ollama and Anthropic are deliberately not in that table: different endpoints,
// different payload keys, different framing. Pretending otherwise would cost
// more in special cases than the duplication saves.
//
// Each of the three is a `Conversation`: a history, a way to ask the model over
// it, and a way to write down what its tool calls came back with. A request
// with no tools is that conversation asked once. A request with tools is the
// same conversation asked until the model stops calling things -- so the loop
// is written once, below, and what differs per dialect is only what differs on
// the wire.

import type { AiRequest, AiService, ToolAccess, ToolSpec } from '../elements/Runtime.ts';

export interface ProviderSettings {
  /** Which provider a node's `default` resolves to. */
  provider: string;
  model: string;
  apiKeys: Record<string, string>;
  endpoints: Record<string, string>;
  /** Attempts in total, including the first. */
  attempts: number;
  /** Seconds before the first retry; doubled each time after. */
  retryDelay: number;
  maxTokens: number;
  /**
   * How long to wait for an answer. 0 means no clock at all.
   *
   * Five minutes used to be the default, and a local model asked to design a
   * whole graph is simply slower than that -- the request was aborted while it
   * was still writing, which reads as "nothing happens". Waiting is the right
   * default for a machine you are running yourself; set AI_GRAPH_TIMEOUT_MS to
   * put a clock back on it.
   */
  timeoutMs: number;
}

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: 'ollama',
  model: '',
  apiKeys: {},
  endpoints: {
    ollama: 'http://localhost:11434',
    lmstudio: 'http://localhost:1234/v1',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta/openai',
    github_copilot: 'https://models.github.ai/inference',
    openai_compatible: '',
  },
  attempts: 3,
  retryDelay: 1,
  maxTokens: 4096,
  timeoutMs: 0,
};

/** A provider that speaks the OpenAI chat-completions API. */
interface OpenAIStyle {
  /** Which key in `endpoints` holds its base URL. */
  endpoint: string;
  /** Which key in `apiKeys` holds its credential, if it wants one. */
  credential?: string;
  credentialRequired?: boolean;
  missingCredential?: string;
  missingEndpoint?: string;
}

const OPENAI_STYLE: Record<string, OpenAIStyle> = {
  openai: {
    endpoint: 'openai',
    credential: 'openai',
    credentialRequired: true,
    missingCredential: 'No OpenAI API key configured (OPENAI_API_KEY).',
  },
  // A local LM Studio needs no credential at all.
  lmstudio: { endpoint: 'lmstudio' },
  openai_compatible: {
    endpoint: 'openai_compatible',
    // Optional on purpose: many self-hosted endpoints have no key.
    credential: 'openai_compatible',
    missingEndpoint: 'No OpenAI-compatible endpoint configured (OPENAI_COMPATIBLE_BASE_URL).',
  },
  google: {
    endpoint: 'google',
    credential: 'google',
    credentialRequired: true,
    missingCredential:
      'No Google API key configured (GOOGLE_API_KEY). A free one: https://aistudio.google.com/apikey',
  },
  github_copilot: {
    endpoint: 'github_copilot',
    credential: 'github',
    credentialRequired: true,
    missingCredential: 'No GITHUB_TOKEN configured.',
  },
};

/**
 * A completion that came back empty.
 *
 * Worth its own type because it is not a failure the provider reports: the
 * request succeeded, the body was well-formed, and the text was "". A local
 * model does this under load. Treated as success it becomes an empty node
 * output that everything downstream quietly runs with; treated as retryable it
 * usually goes away on the second attempt.
 */
export class EmptyCompletionError extends Error {
  constructor(provider: string, model: string) {
    super(`${provider}/${model} returned an empty completion.`);
    this.name = 'EmptyCompletionError';
  }
}

/**
 * The model ran out of tokens before it said anything.
 *
 * Its own type because it must not be retried: the same request with the same
 * budget ends the same way, only slower.
 */
export class OutOfBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutOfBudgetError';
  }
}

/** The run was stopped by the person running it. Never retried: they meant it. */
export class StoppedError extends Error {
  constructor() {
    super('Stopped.');
    this.name = 'StoppedError';
  }
}

/** Worth another attempt: rate limits, and the 5xx family that means "not you". */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class HttpError extends Error {
  // A plain field, not a parameter property. Node runs this engine by stripping
  // types, and a `readonly` in a constructor's parameter list is one of the few
  // things it cannot strip — it would have to emit an assignment. A bundle must
  // need no build step, so the engine stays inside what stripping allows;
  // `strippable.test.ts` holds the whole engine to that.
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof StoppedError || error instanceof OutOfBudgetError) return false;
  if (error instanceof EmptyCompletionError) return true;
  if (error instanceof HttpError) return RETRYABLE_STATUS.has(error.status);
  // A dropped connection or a timeout: the request never got an answer, so
  // asking again is the reasonable thing rather than a guess.
  return error instanceof TypeError || (error as { name?: string })?.name === 'AbortError';
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  stop?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (stop?.aborted) throw new StoppedError();
  const abort = new AbortController();
  // The person pressing Stop and the clock running out end the call the same
  // way, through the one controller fetch is listening to.
  const onStop = () => abort.abort();
  stop?.addEventListener('abort', onStop, { once: true });
  // No timer at all when there is no timeout: an AbortController that is never
  // fired lets a slow model finish, and a socket that dies still ends the call.
  const timer = timeoutMs > 0 ? setTimeout(() => abort.abort(), timeoutMs) : undefined;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      // The provider's own message, not just the code: "model not found" and
      // "quota exceeded" are both 400 and need different things done about them.
      throw new HttpError(response.status, `${response.status}: ${detail(text)}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    // Said as what it was. Left as an AbortError it reads as a dropped
    // connection, and a dropped connection is retried.
    if (stop?.aborted) throw new StoppedError();
    throw error;
  } finally {
    stop?.removeEventListener('abort', onStop);
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The sentence inside a provider's error body, if it put one there. */
function detail(body: string): string {
  try {
    const whole = JSON.parse(body) as unknown;
    // Google wraps its error in a one-element list, which left the person
    // reading six lines of JSON to find the one sentence in it.
    const parsed = (Array.isArray(whole) ? whole[0] : whole) as
      { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') return parsed.error;
    return parsed.error?.message ?? parsed.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

// ---------------------------------------------------------------------------
// What the three dialects have in common
// ---------------------------------------------------------------------------

/** One thing the model asked to have done. */
interface ToolCall {
  id: string;
  name: string;
  /** What to call it with -- or, as a string, the reason that could not be read. */
  args: Record<string, unknown> | string;
}

/** What the model said in one turn: words, requests, or both. */
interface ModelTurn {
  text: string;
  calls: ToolCall[];
}

/**
 * What a turn is asked *with*.
 *
 * `plain` is a request that has no tools and says nothing about them: the body
 * every request had before tools existed, unchanged. `tools` offers them.
 * `final` is the turn after the last round: the history is full of tool calls,
 * so the tools still have to be described, but the model may not use them.
 */
type AskMode = 'plain' | 'tools' | 'final';

interface Conversation {
  /**
   * One model call over the history so far. It does not touch the history, so
   * the retry pass can ask again after an empty answer without the empty answer
   * having become part of what is asked.
   */
  ask(mode: AskMode): Promise<ModelTurn>;
  /** The turn last asked for, and what each of its calls came back with, written into the history. */
  record(results: string[]): void;
  /** Something said to the model as the user. */
  say(text: string): void;
}

/** A model that is still calling tools after this many turns is not converging on an answer. */
const MAX_TOOL_ROUNDS = 8;

const OUT_OF_ROUNDS = 'That was the last tool call available for this answer. '
  + 'Do not call any more tools. Answer now, with what you have found so far.';

/**
 * A tool call's arguments, as an object -- or as a sentence saying why not.
 *
 * OpenAI-style providers send a JSON *string* the model wrote token by token,
 * and a model can get JSON wrong. That is its mistake to fix, so the reason
 * goes back to it as the tool's result rather than ending the run. The empty
 * string is not a mistake: it is what several providers send for a tool that
 * takes no arguments.
 */
function readArguments(raw: unknown): Record<string, unknown> | string {
  let value = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return {};
    try {
      value = JSON.parse(raw);
    } catch {
      return `the arguments were not valid JSON: ${raw.slice(0, 200)}`;
    }
  }
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    return `the arguments must be a JSON object, and were: ${JSON.stringify(value).slice(0, 200)}`;
  }
  return value as Record<string, unknown>;
}

/** Keys that describe a schema *document* and mean nothing to a model. Providers reject them. */
const SCHEMA_NOISE = new Set(['$schema', '$id', '$comment']);
/** Keys whose children are named by the schema's author, so `$id` there is a parameter called `$id`. */
const SCHEMA_NAMED = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
/** Keys whose value is data, not schema, and is nobody's business to edit. */
const SCHEMA_DATA = new Set(['default', 'const', 'enum', 'examples']);

/**
 * A tool's parameters as a provider will take them.
 *
 * MCP servers generate their schemas, and generators sign their work: nearly
 * every one arrives with a `$schema` line that Gemini answers with a 400. What
 * is removed is only what cannot change the meaning. Anything else a provider
 * objects to is left in, so that the objection names the real key.
 */
function cleanSchema(schema: unknown, named = false): unknown {
  if (Array.isArray(schema)) return schema.map((item) => cleanSchema(item));
  if (!schema || typeof schema !== 'object') return schema;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (named) clean[key] = cleanSchema(value);
    else if (SCHEMA_NOISE.has(key)) continue;
    else if (SCHEMA_DATA.has(key)) clean[key] = value;
    else clean[key] = cleanSchema(value, SCHEMA_NAMED.has(key));
  }
  return clean;
}

function parametersOf(spec: ToolSpec): Record<string, unknown> {
  const clean = cleanSchema(spec.parameters ?? {}) as Record<string, unknown>;
  // A tool with no arguments is often listed with no schema to speak of, and
  // every provider insists on an object schema all the same.
  return clean.type ? clean : { type: 'object', properties: {}, ...clean };
}

/** OpenAI's way of describing a tool, which Ollama borrowed whole. */
const functionTool = (spec: ToolSpec): unknown => ({
  type: 'function',
  function: { name: spec.name, description: spec.description, parameters: parametersOf(spec) },
});

/**
 * Run one call the model asked for.
 *
 * The one place a tool is actually invoked, whichever dialect asked -- which is
 * where an `onToolCall` hook goes on the day the interface wants to show "is
 * searching the web…": `report(call)` before, `report(call, result)` after.
 */
async function runTool(tools: ToolAccess, call: ToolCall): Promise<string> {
  if (typeof call.args === 'string') return `Tool error: ${call.args}`;
  if (!tools.specs.some((spec) => spec.name === call.name)) {
    const names = tools.specs.map((spec) => spec.name).join(', ');
    return `Tool error: there is no tool named "${call.name}". The tools are: ${names}.`;
  }
  // No catch. What comes back from here as text is the model's to react to;
  // what is *thrown* is the tool server itself failing, and the node should
  // fail with it rather than answer as though it had tools.
  const result = await tools.call(call.name, call.args);
  // Some providers refuse an empty tool message, and "nothing" is an answer.
  return result.trim() ? result : '(the tool returned nothing)';
}

/**
 * Ask, run what was asked for, tell the model, ask again.
 *
 * Calls within a turn run one after another, in the order the model wrote
 * them: tools have side effects, and "create the file, then append to it" in
 * parallel is a race the model did not ask for.
 */
async function toolLoop(
  conversation: Conversation,
  ask: (mode: AskMode) => Promise<ModelTurn>,
  tools: ToolAccess,
): Promise<string> {
  for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
    const turn = await ask('tools');
    // Words and no calls: that is the answer. Words *beside* calls are the
    // model thinking aloud ("let me look that up"), and are not.
    if (!turn.calls.length) return turn.text;

    const results: string[] = [];
    for (const call of turn.calls) results.push(await runTool(tools, call));
    conversation.record(results);
  }

  // Out of rounds. What it has gathered so far is worth more than an error, so
  // it is asked once more, plainly, with the tools taken away.
  conversation.say(OUT_OF_ROUNDS);
  return (await ask('final')).text;
}

// ---------------------------------------------------------------------------
// The dialects
// ---------------------------------------------------------------------------

function messages(request: AiRequest): unknown[] {
  const content = request.images?.length
    ? [
        { type: 'text', text: request.prompt },
        ...request.images.map((image) => ({
          type: 'image_url',
          image_url: { url: image.startsWith('data:') ? image : `data:image/png;base64,${image}` },
        })),
      ]
    : request.prompt;
  return [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content },
  ];
}

function openAiStyle(
  provider: string,
  request: AiRequest,
  settings: ProviderSettings,
): Conversation {
  const spec = OPENAI_STYLE[provider];
  const base = settings.endpoints[spec.endpoint] ?? '';
  if (!base) throw new Error(spec.missingEndpoint ?? `No base URL configured for ${provider}.`);

  const headers: Record<string, string> = {};
  if (spec.credential) {
    const token = settings.apiKeys[spec.credential] ?? '';
    if (!token && spec.credentialRequired) throw new Error(spec.missingCredential!);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const history = messages(request);
  const offered = request.tools?.specs.map(functionTool) ?? [];
  let said: unknown;
  let calls: ToolCall[] = [];

  return {
    async ask(mode) {
      const body = await post(`${base.replace(/\/$/, '')}/chat/completions`, {
        model: request.model,
        messages: history,
        temperature: request.temperature ?? 0.7,
        max_tokens: settings.maxTokens,
        ...(mode === 'plain' ? {} : { tools: offered }),
        // Still described, no longer on offer. Dropping `tools` altogether
        // would be simpler, and some servers then refuse a history that is
        // full of calls to tools they were never told about.
        ...(mode === 'final' ? { tool_choice: 'none' } : {}),
      }, headers, settings.timeoutMs, request.signal);

      const choices = body.choices as {
        finish_reason?: string;
        message?: { content?: string; tool_calls?: unknown; reasoning_content?: string };
      }[] | undefined;
      const message = choices?.[0]?.message;

      // A model that thinks before it answers -- most local ones do now -- spends
      // the same token budget on the thinking. When the budget runs out there,
      // the answer is empty, and an empty answer is otherwise retried: three
      // long waits for the same nothing. Said as what it is, once.
      if (choices?.[0]?.finish_reason === 'length' && !message?.content?.trim()
          && !(Array.isArray(message?.tool_calls) && message.tool_calls.length)) {
        const thought = message?.reasoning_content?.length ?? 0;
        throw new OutOfBudgetError(
          `${provider}/${request.model} used its whole budget of ${settings.maxTokens} tokens`
          + `${thought ? ` thinking (${thought} characters of it)` : ''} and had none left for the answer. `
          + 'Raise AI_GRAPH_MAX_TOKENS, turn the model\'s thinking off where it is served, or use a model that does not think.',
        );
      }
      const asked = (Array.isArray(message?.tool_calls) ? message.tool_calls : []) as
        { id?: string; function?: { name?: string; arguments?: unknown } }[];
      said = message;
      calls = asked.map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function?.name ?? '',
        args: readArguments(call.function?.arguments),
      }));
      return { text: message?.content ?? '', calls };
    },

    record(results) {
      // The assistant's message goes back *as it arrived*, not rebuilt from the
      // parts understood here. Gemini 3 hangs a thought signature on each tool
      // call (`extra_content`) and rejects the next turn if it comes back
      // without one; whatever the next provider invents will live in the same
      // place. The only way not to lose a field nobody has heard of yet is to
      // not take the message apart.
      history.push(said, ...calls.map((call, index) => ({
        role: 'tool',
        tool_call_id: call.id,
        content: results[index],
      })));
    },

    say(text) { history.push({ role: 'user', content: text }); },
  };
}

function anthropic(request: AiRequest, settings: ProviderSettings): Conversation {
  const key = settings.apiKeys.anthropic ?? '';
  if (!key) throw new Error('No Anthropic API key configured (ANTHROPIC_API_KEY).');

  const history: unknown[] = [{ role: 'user', content: request.prompt }];
  const offered = request.tools?.specs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    input_schema: parametersOf(spec),
  })) ?? [];
  let said: unknown;
  let calls: ToolCall[] = [];

  return {
    async ask(mode) {
      const body = await post(`${settings.endpoints.anthropic}/messages`, {
        model: request.model,
        max_tokens: settings.maxTokens,
        temperature: request.temperature ?? 0.7,
        ...(request.system ? { system: request.system } : {}),
        messages: history,
        ...(mode === 'plain' ? {} : { tools: offered }),
        // Anthropic is the provider that *insists* on `tools` while the history
        // holds tool_use blocks, so taking them away is said this way.
        ...(mode === 'final' ? { tool_choice: { type: 'none' } } : {}),
      }, {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      }, settings.timeoutMs, request.signal);

      const content = body.content as { type?: string; text?: string; id?: string; name?: string; input?: unknown }[] | undefined;
      said = content;
      calls = (content ?? []).filter((part) => part.type === 'tool_use').map((part, index) => ({
        id: part.id ?? `toolu_${index}`,
        name: part.name ?? '',
        args: readArguments(part.input),
      }));
      return { text: content?.map((part) => part.text ?? '').join('') ?? '', calls };
    },

    record(results) {
      // Here a turn is a list of blocks, and results travel as a *user* message
      // answering the assistant's blocks by id. The blocks go back whole, for
      // the same reason as above: a thinking block carries a signature too.
      history.push(
        { role: 'assistant', content: said },
        {
          role: 'user',
          content: calls.map((call, index) => ({
            type: 'tool_result',
            tool_use_id: call.id,
            content: results[index],
            ...(results[index].startsWith('Tool error:') ? { is_error: true } : {}),
          })),
        },
      );
    },

    say(text) { history.push({ role: 'user', content: text }); },
  };
}

function ollama(request: AiRequest, settings: ProviderSettings): Conversation {
  const history: unknown[] = [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content: request.prompt, ...(request.images?.length ? { images: request.images } : {}) },
  ];
  const offered = request.tools?.specs.map(functionTool) ?? [];
  let said: unknown;
  let calls: ToolCall[] = [];

  return {
    async ask(mode) {
      const body = await post(`${settings.endpoints.ollama}/api/chat`, {
        model: request.model,
        stream: false,
        options: { temperature: request.temperature ?? 0.7 },
        messages: history,
        // Ollama has no `tool_choice`, and does not mind a history of calls to
        // tools it is no longer shown. So `final` simply stops showing them.
        ...(mode === 'tools' ? { tools: offered } : {}),
      }, {}, settings.timeoutMs, request.signal);

      const message = body.message as
        { content?: string; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } | undefined;
      said = message;
      calls = (Array.isArray(message?.tool_calls) ? message.tool_calls : []).map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function?.name ?? '',
        // Already an object here, where OpenAI sends a string. `readArguments`
        // takes either, because "compatible" servers send both.
        args: readArguments(call.function?.arguments),
      }));
      return { text: message?.content ?? '', calls };
    },

    record(results) {
      // Matched to its call by the tool's name: there are no call ids here.
      history.push(said, ...calls.map((call, index) => ({
        role: 'tool',
        content: results[index],
        tool_name: call.name,
      })));
    },

    say(text) { history.push({ role: 'user', content: text }); },
  };
}

/**
 * The provider set, with one retry pass.
 *
 * Retrying is not politeness: a local model under load answers with an empty
 * body often enough that a graph of fifty AI nodes will hit it, and the failure
 * it produces — an empty string flowing downstream — is invisible. One pass
 * costs a few seconds and removes the most common way a long run comes back
 * subtly wrong.
 *
 * The pass is around each *model call*, not around the request: with tools, a
 * request is several calls with side effects in between, and retrying the whole
 * of it because turn five came back empty would send the email twice.
 */
export function aiService(settings: Partial<ProviderSettings> = {}): AiService {
  const config: ProviderSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...settings.apiKeys },
    endpoints: { ...DEFAULT_SETTINGS.endpoints, ...settings.endpoints },
  };

  const attempt = async <T>(call: () => Promise<T>): Promise<T> => {
    let lastError: unknown;
    for (let tries = 1; tries <= config.attempts; tries += 1) {
      try {
        return await call();
      } catch (error) {
        lastError = error;
        if (tries === config.attempts || !isRetryable(error)) throw error;
        const delay = config.retryDelay * 2 ** (tries - 1) * 1000;
        await new Promise((wake) => setTimeout(wake, delay));
      }
    }
    throw lastError;
  };

  return {
    async complete(request: AiRequest): Promise<string> {
      const provider = request.provider && request.provider !== 'default'
        ? request.provider
        : config.provider;
      const model = request.model || config.model;
      if (!model) {
        throw new Error(
          `No model configured for provider '${provider}'. Name one on the AI node, `
          + 'or set the run-level default.',
        );
      }

      const open = (): Conversation => {
        const asked = { ...request, model };
        if (provider in OPENAI_STYLE) return openAiStyle(provider, asked, config);
        if (provider === 'anthropic') return anthropic(asked, config);
        if (provider === 'ollama') return ollama(asked, config);
        throw new Error(`Unknown AI provider: ${provider}`);
      };
      const conversation = open();

      const ask = (mode: AskMode): Promise<ModelTurn> => attempt(async () => {
        const turn = await conversation.ask(mode);
        // A turn that calls a tool has said something, with or without words.
        if (mode === 'tools' && turn.calls.length) return turn;
        if (!turn.text.trim()) {
          if (mode === 'final' && turn.calls.length) {
            throw new Error(
              `${provider}/${model} was still calling tools after ${MAX_TOOL_ROUNDS} rounds, `
              + 'and would not answer without them.',
            );
          }
          throw new EmptyCompletionError(provider, model);
        }
        return turn;
      });

      // An empty tool list is no tools: some providers reject `tools: []`, and
      // a session that opened no servers should cost a request nothing.
      const tools = request.tools;
      if (!tools?.specs.length) return (await ask('plain')).text;
      return toolLoop(conversation, ask, tools);
    },
  };
}

/** Settings from the environment, the way a server or a bundle is configured. */
export function settingsFromEnv(env: Record<string, string | undefined>): Partial<ProviderSettings> {
  const endpoints: Record<string, string> = {};
  for (const [key, name] of [
    ['ollama', 'OLLAMA_BASE_URL'], ['lmstudio', 'LMSTUDIO_BASE_URL'],
    ['openai_compatible', 'OPENAI_COMPATIBLE_BASE_URL'], ['google', 'GOOGLE_BASE_URL'],
    ['github_copilot', 'GITHUB_MODELS_BASE_URL'],
  ] as const) {
    if (env[name]) endpoints[key] = env[name]!;
  }

  const apiKeys: Record<string, string> = {};
  for (const [key, name] of [
    ['openai', 'OPENAI_API_KEY'], ['anthropic', 'ANTHROPIC_API_KEY'],
    ['google', 'GOOGLE_API_KEY'], ['github', 'GITHUB_TOKEN'],
    ['openai_compatible', 'OPENAI_COMPATIBLE_API_KEY'],
  ] as const) {
    if (env[name]) apiKeys[key] = env[name]!;
  }

  // A number, including 0 for "wait as long as it takes" -- so the knob can put
  // a clock back on as well as take one off.
  const timeout = Number(env.AI_GRAPH_TIMEOUT_MS);
  const budget = Number(env.AI_GRAPH_MAX_TOKENS);

  return {
    ...(env.AI_GRAPH_AI_PROVIDER ? { provider: env.AI_GRAPH_AI_PROVIDER } : {}),
    ...(env.AI_GRAPH_AI_MODEL ? { model: env.AI_GRAPH_AI_MODEL } : {}),
    ...(Number.isFinite(timeout) && timeout >= 0 && env.AI_GRAPH_TIMEOUT_MS ? { timeoutMs: timeout } : {}),
    ...(Number.isFinite(budget) && budget > 0 ? { maxTokens: budget } : {}),
    endpoints,
    apiKeys,
  };
}
