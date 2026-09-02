import { NodeElement, type Runtime } from '../../element.ts';
import { Logic, logicFrom } from '../../logic.ts';
import type { GraphNode } from '../../graph.ts';
import { imageDataUrl, imageMediaType } from '../../images.ts';
import type { LogicFields } from '../../logic.ts';
import type { Generation } from '../../generation.ts';

/** Where an ai node keeps its two halves; used by both declarations below. */
const PROMPT_FIELDS: LogicFields = {
  body: 'system_prompt', prompt: 'description', file: 'code_file', promptOnSubject: true,
};

export interface AiConfig {
  systemPrompt: string;
  provider: string;
  model: string;
  temperature: number;
  sendImages: boolean;
  /** What the model is told to produce. A generation input, not a runtime check. */
  outputFormat: string;
  outputFormatPrompt: string;
  /** Return a failed call as an `error` port instead of failing the node. */
  catchErrors: boolean;
}

/**
 * A node that asks a model.
 *
 * The prompt is **everything wired into it**, joined by blank lines, in port
 * order. Not a port named `prompt`: a node with two inputs wired to two
 * different upstream nodes should send both, and naming one of them would make
 * the second silently disappear. What the node itself adds is the system
 * prompt — the part someone wrote.
 *
 * Running once per item is not here. A node that fans out does so the same way
 * a code node does, in the executor, because "run this once per element" is a
 * property of the graph rather than of asking a model.
 */
export class AiElement extends NodeElement<AiConfig> {
  readonly nodeType = 'ai' as const;

  config(node: GraphNode): AiConfig {
    const c = node.config;
    return {
      systemPrompt: String(c.system_prompt ?? ''),
      provider: String(c.ai_provider ?? ''),
      model: String(c.ai_model ?? ''),
      temperature: Number(c.temperature ?? 0.7),
      sendImages: c.send_images === true,
      outputFormat: String(c.output_format ?? 'text'),
      outputFormatPrompt: String(c.output_format_prompt ?? ''),
      catchErrors: c.catch_errors === true,
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

  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const settings = this.config(node);
    const parts: string[] = [];
    const images: string[] = [];

    for (const value of Object.values(inputs)) {
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
      // A list becomes its items, one per paragraph -- not a serialization of
      // the list, which puts brackets, quotes and commas into the prompt and
      // makes the model read around syntax to find the text. Three summaries
      // wired into a node should arrive as three paragraphs.
      for (const item of Array.isArray(value) ? value : [value]) {
        parts.push(typeof item === 'string' ? item : JSON.stringify(item));
      }
    }

    const instruction = formatInstruction(settings);
    const request = {
      prompt: parts.join('\n\n'),
      system: instruction ? `${settings.systemPrompt}\n\n${instruction}` : settings.systemPrompt,
      provider: settings.provider,
      model: settings.model,
      temperature: settings.temperature,
      ...(images.length ? { images } : {}),
    };

    // Off by default: a call that fails still fails the node, as it always
    // did. On, a failure becomes data instead -- an `error` port a person adds
    // by hand, the same way any other output port on this node is named,
    // wired to whatever should happen when the model could not be reached.
    if (!settings.catchErrors) return { output: await runtime.ai.complete(request) };
    try {
      return { output: await runtime.ai.complete(request), error: '' };
    } catch (error) {
      return { output: '', error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** What the node was told to ask for, as a sentence the model can follow. */
function formatInstruction(settings: AiConfig): string {
  if (settings.outputFormat === 'custom') return settings.outputFormatPrompt;
  if (settings.outputFormat === 'json') return 'Respond with JSON and nothing else.';
  if (settings.outputFormat.startsWith('csv')) return 'Respond with CSV and nothing else.';
  return '';
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
