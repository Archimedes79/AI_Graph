import { GraphNodeElement } from '../../GraphNodeElement.ts';
import { type Runtime } from '../../Runtime.ts';
import { Logic, logicFrom } from '../../../authoring/logic.ts';
import type { GraphNode } from '../../../graph.ts';
import { imageDataUrl, imageMediaType } from '../../../execution/images.ts';
import type { LogicFields } from '../../../authoring/logic.ts';
import type { Generation } from '../../../authoring/generation.ts';
import { assemblePrompt, type PromptSettings } from './prompt.ts';

/** Where an ai node keeps its two halves; used by both declarations below. */
const PROMPT_FIELDS: LogicFields = {
  body: 'system_prompt', prompt: 'description', file: 'code_file', promptOnSubject: true,
};

export interface AiConfig extends PromptSettings {
  provider: string;
  model: string;
  temperature: number;
  sendImages: boolean;
  /** Tool servers the model may call while answering: URLs, or names this machine configured. */
  toolServers: string[];
}

/** One per line, or a list: both are what a person would write. */
function serverList(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : String(raw ?? '').split(/\r?\n/);
  return entries.map((entry) => String(entry).trim()).filter(Boolean);
}

/**
 * A node that asks a model.
 *
 * The prompt is **everything wired into it**, in port order -- laid out by the
 * node's message template when it has one, joined by blank lines when it does
 * not (see `prompt.ts`). Not a port named `prompt`: a node with two inputs
 * wired to two different upstream nodes should send both, and naming one of
 * them would make the second silently disappear. What the node itself adds is
 * the system prompt — the part someone wrote.
 *
 * Running once per item is not here. A node that fans out does so the same way
 * a code node does, in the executor, because "run this once per element" is a
 * property of the graph rather than of asking a model.
 */
export class AiNode extends GraphNodeElement<AiConfig> {
  readonly nodeType = 'ai' as const;

  config(node: GraphNode): AiConfig {
    const c = node.config;
    return {
      systemPrompt: String(c.system_prompt ?? ''),
      provider: String(c.ai_provider ?? ''),
      model: String(c.ai_model ?? ''),
      temperature: Number(c.temperature ?? 0.7),
      sendImages: c.send_images === true,
      template: String(c.prompt_template ?? ''),
      outputFormat: String(c.output_format ?? 'text'),
      outputFormatPrompt: String(c.output_format_prompt ?? ''),
      outputExample: String(c.output_example ?? ''),
      toolServers: serverList(c.mcp_servers),
    };
  }

  /**
   * The system prompt is what someone writes for an ai node — markdown, not a
   * script that calls the model. Such a script would be a second copy of what
   * the provider layer already does, and would drift from it immediately.
   */
  override logic(node: GraphNode): Logic {
    // The request is the node's own description, not a config field: an ai
    // node's description IS what you asked the model to be.
    return logicFrom(node, 'prompt', PROMPT_FIELDS, 'this prompt');
  }

  /** The one element whose request lives on the node rather than in its config. */
  override generation(): Generation {
    return {
      kind: 'prompt', fields: PROMPT_FIELDS,
      guard: 'Please add a description first.',
      success: '✅ Prompt generated!',
    };
  }

  override deployNeeds() {
    return { needsInterface: false };
  }

  /** What is wired in is the question: with all of it empty there is nothing to ask. */
  override needsInput(): boolean {
    return true;
  }

  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const settings = this.config(node);
    const text: Record<string, unknown> = {};
    const images: string[] = [];

    // Port order, not the order the edges happen to be stored in: the message
    // a person previews must be the message that is sent.
    const declared = node.inputs.map((port) => port.id);
    const order = [...declared.filter((id) => id in inputs), ...Object.keys(inputs).filter((id) => !declared.includes(id))];

    for (const name of order) {
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
    if (!settings.toolServers.length) return { output: await runtime.ai.complete(request) };

    // Tools live for one run of this node and no longer: a server started for
    // a question is stopped when the question is answered, so a graph that ran
    // leaves nothing running behind it.
    if (!runtime.tools) throw new Error('This node asks for tool servers, and nothing here can reach one.');
    const session = await runtime.tools.open(settings.toolServers);
    try {
      return { output: await runtime.ai.complete({ ...request, tools: session }) };
    } finally {
      await session.close();
    }
  }
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
