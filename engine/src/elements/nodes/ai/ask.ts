// Asking a model, as a node does it -- and as a body may ask for it to be done.
//
// One function, because there is one way: what arrived is laid out by the
// message template, images are sent as images, tool servers live for the length
// of the question. An ai node left as it is calls it directly; a `run.js` of
// someone's own, and a code node, reach the same function through `node.llm`
// (see `runTemplate.ts` and `Runtime.BodyContext`), so a call made from a body
// is not a second, thinner way to ask.

import type { Runtime } from '../../Runtime.ts';
import { imageDataUrl, imageMediaType } from '../../../execution/images.ts';
import { assemblePrompt, type PromptSettings } from './prompt.ts';
import { LLM_CALLS_PER_RUN } from './runTemplate.ts';

export interface AskSettings extends PromptSettings {
  provider: string;
  model: string;
  temperature: number;
  sendImages: boolean;
  /** Tool servers the model may call while answering: URLs, or names this machine configured. */
  toolServers: string[];
}

/** Nothing said: the graph's default model, plain text, no tools. What a code node's `node.llm` starts from. */
export const PLAIN_ASK: AskSettings = {
  systemPrompt: '', template: '', outputFormat: 'text', outputFormatPrompt: '', outputExample: '',
  provider: 'default', model: '', temperature: 0.7, sendImages: false, toolServers: [],
};

/**
 * Ask once. *order* is the node's own port order: the message a person
 * previews must be the message that is sent, whatever order the edges are
 * stored in.
 */
export async function askModel(
  settings: AskSettings,
  inputs: Record<string, unknown>,
  runtime: Runtime,
  order: string[] = [],
): Promise<string> {
  const text: Record<string, unknown> = {};
  const images: string[] = [];
  const names = [...order.filter((id) => id in inputs), ...Object.keys(inputs).filter((id) => !order.includes(id))];

  for (const name of names) {
    const value = inputs[name];
    if (value === null || value === undefined) continue;
    if (settings.sendImages) {
      // An input that *is* an image becomes an image in the request rather
      // than a path pasted into the prompt. A list is expanded, so a folder
      // picker wired straight in sends every file.
      //
      // Read here, not passed as a path: the provider's machine is not this
      // one, so a filename would arrive as a filename and the model would
      // dutifully talk about the filename.
      const candidates = Array.isArray(value) ? value : [value];
      const urls: string[] = [];
      for (const candidate of candidates) {
        const url = await asImageUrl(candidate, runtime);
        if (url) urls.push(url);
      }
      if (urls.length) {
        images.push(...urls);
        continue;
      }
    }
    text[name] = value;
  }

  const { system, user } = assemblePrompt(settings, text);
  const request = {
    prompt: user,
    system,
    provider: settings.provider,
    model: settings.model,
    temperature: settings.temperature,
    ...(images.length ? { images } : {}),
  };

  // A failed call is not caught here: `catch_errors` is read by the executor,
  // which turns a throw into this node's `error` port for every element
  // alike. One mechanism, not one per element.
  if (!settings.toolServers.length) return runtime.ai.complete(request);

  // Tools live for one question and no longer: a server started for it is
  // stopped when it is answered, so a graph that ran leaves nothing running.
  if (!runtime.tools) throw new Error('This node asks for tool servers, and nothing here can reach one.');
  const session = await runtime.tools.open(settings.toolServers);
  try {
    return await runtime.ai.complete({ ...request, tools: session });
  } finally {
    await session.close();
  }
}

/** What a body may say when it asks: everything optional, the node's settings for the rest. */
interface LlmArgs {
  system?: unknown;
  message?: unknown;
  inputs?: unknown;
  /** Instead of `message` + `inputs`, for a call that is just a question. */
  prompt?: unknown;
  temperature?: unknown;
  provider?: unknown;
  model?: unknown;
}

/**
 * `node.llm`, as the process holding the keys answers it.
 *
 * Counted, because the body asking is code nobody may have read: a loop that
 * forgot to end asks a finite number of times and then is told why it stopped.
 */
export function llmCall(
  settings: AskSettings,
  runtime: Runtime,
  order: string[] = [],
): (args: unknown) => Promise<unknown> {
  const most = runtime.llmCallsPerBody ?? LLM_CALLS_PER_RUN;
  let asked = 0;
  return async (raw) => {
    asked += 1;
    if (asked > most) {
      throw new Error(`This body has asked the model ${most} times in one run, which is as often as it may. `
        + 'If it is meant to ask more, raise AI_GRAPH_MAX_LLM_CALLS where the tool runs.');
    }
    const args = (raw && typeof raw === 'object' ? raw : {}) as LlmArgs;
    const given = args.inputs && typeof args.inputs === 'object' && !Array.isArray(args.inputs)
      ? args.inputs as Record<string, unknown> : {};
    const question = typeof args.prompt === 'string';
    return askModel({
      ...settings,
      ...(typeof args.system === 'string' ? { systemPrompt: args.system } : {}),
      ...(typeof args.message === 'string' ? { template: args.message } : {}),
      ...(question ? { template: '' } : {}),
      ...(typeof args.temperature === 'number' ? { temperature: args.temperature } : {}),
      ...(typeof args.provider === 'string' && args.provider ? { provider: args.provider } : {}),
      ...(typeof args.model === 'string' && args.model ? { model: args.model } : {}),
    }, question ? { prompt: args.prompt } : given, runtime, order);
  };
}

/**
 * An image, inlined — or null for anything that is just text.
 *
 * A file that looks like an image but cannot be read (missing, too large, not
 * actually one) counts as text: it goes into the prompt as the string it is,
 * which is what someone wiring a filename in would expect, rather than failing
 * the whole node over a picture it was optional to send.
 */
async function asImageUrl(value: unknown, runtime: Runtime): Promise<string | null> {
  if (typeof value !== 'string') return null;
  if (value.startsWith('data:image/')) return value;
  if (!imageMediaType(value)) return null;
  try {
    return await imageDataUrl(value, runtime.files);
  } catch {
    return null;
  }
}
