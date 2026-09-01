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

import type { AiRequest, AiService } from '../element.ts';

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
  timeoutMs: 300_000,
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
): Promise<Record<string, unknown>> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
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
  } finally {
    clearTimeout(timer);
  }
}

/** The sentence inside a provider's error body, if it put one there. */
function detail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') return parsed.error;
    return parsed.error?.message ?? parsed.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

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

async function openAiStyle(
  provider: string,
  request: AiRequest,
  settings: ProviderSettings,
): Promise<string> {
  const spec = OPENAI_STYLE[provider];
  const base = settings.endpoints[spec.endpoint] ?? '';
  if (!base) throw new Error(spec.missingEndpoint ?? `No base URL configured for ${provider}.`);

  const headers: Record<string, string> = {};
  if (spec.credential) {
    const token = settings.apiKeys[spec.credential] ?? '';
    if (!token && spec.credentialRequired) throw new Error(spec.missingCredential!);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const body = await post(`${base.replace(/\/$/, '')}/chat/completions`, {
    model: request.model,
    messages: messages(request),
    temperature: request.temperature ?? 0.7,
    max_tokens: settings.maxTokens,
  }, headers, settings.timeoutMs);

  const choices = body.choices as { message?: { content?: string } }[] | undefined;
  return choices?.[0]?.message?.content ?? '';
}

async function anthropic(request: AiRequest, settings: ProviderSettings): Promise<string> {
  const key = settings.apiKeys.anthropic ?? '';
  if (!key) throw new Error('No Anthropic API key configured (ANTHROPIC_API_KEY).');

  const body = await post(`${settings.endpoints.anthropic}/messages`, {
    model: request.model,
    max_tokens: settings.maxTokens,
    temperature: request.temperature ?? 0.7,
    ...(request.system ? { system: request.system } : {}),
    messages: [{ role: 'user', content: request.prompt }],
  }, {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  }, settings.timeoutMs);

  const content = body.content as { text?: string }[] | undefined;
  return content?.map((part) => part.text ?? '').join('') ?? '';
}

async function ollama(request: AiRequest, settings: ProviderSettings): Promise<string> {
  const body = await post(`${settings.endpoints.ollama}/api/chat`, {
    model: request.model,
    stream: false,
    options: { temperature: request.temperature ?? 0.7 },
    messages: [
      ...(request.system ? [{ role: 'system', content: request.system }] : []),
      { role: 'user', content: request.prompt, ...(request.images?.length ? { images: request.images } : {}) },
    ],
  }, {}, settings.timeoutMs);

  const message = body.message as { content?: string } | undefined;
  return message?.content ?? '';
}

/**
 * The provider set, with one retry pass.
 *
 * Retrying is not politeness: a local model under load answers with an empty
 * body often enough that a graph of fifty AI nodes will hit it, and the failure
 * it produces — an empty string flowing downstream — is invisible. One pass
 * costs a few seconds and removes the most common way a long run comes back
 * subtly wrong.
 */
export function aiService(settings: Partial<ProviderSettings> = {}): AiService {
  const config: ProviderSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...settings.apiKeys },
    endpoints: { ...DEFAULT_SETTINGS.endpoints, ...settings.endpoints },
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

      const call = (): Promise<string> => {
        const asked = { ...request, model };
        if (provider in OPENAI_STYLE) return openAiStyle(provider, asked, config);
        if (provider === 'anthropic') return anthropic(asked, config);
        if (provider === 'ollama') return ollama(asked, config);
        throw new Error(`Unknown AI provider: ${provider}`);
      };

      let lastError: unknown;
      for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
        try {
          const text = await call();
          if (!text.trim()) throw new EmptyCompletionError(provider, model);
          return text;
        } catch (error) {
          lastError = error;
          if (attempt === config.attempts || !isRetryable(error)) throw error;
          const delay = config.retryDelay * 2 ** (attempt - 1) * 1000;
          await new Promise((wake) => setTimeout(wake, delay));
        }
      }
      throw lastError;
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

  return {
    ...(env.AI_GRAPH_AI_PROVIDER ? { provider: env.AI_GRAPH_AI_PROVIDER } : {}),
    ...(env.AI_GRAPH_AI_MODEL ? { model: env.AI_GRAPH_AI_MODEL } : {}),
    endpoints,
    apiKeys,
  };
}
