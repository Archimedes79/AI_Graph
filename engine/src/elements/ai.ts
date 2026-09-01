import { NodeElement, type AuthoredFile, type Runtime } from '../element.ts';
import type { GraphNode } from '../graph.ts';

export interface AiConfig {
  systemPrompt: string;
  provider: string;
  model: string;
  temperature: number;
  sendImages: boolean;
  /** What the model is told to produce. A generation input, not a runtime check. */
  outputFormat: string;
  outputFormatPrompt: string;
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
    };
  }

  /**
   * The system prompt is what someone writes for an ai node — markdown, not a
   * script that calls the model. Such a script would be a second copy of what
   * the provider layer already does, and would drift from it immediately.
   */
  override authoredFile(): AuthoredFile {
    return { bodyField: 'system_prompt', nameField: 'code_file', extension: '.md', what: 'this prompt' };
  }

  override deployNeeds() {
    return { requirements: [], needsInterface: false };
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
        const candidates = Array.isArray(value) ? value : [value];
        const urls = candidates.map(asImageUrl).filter((url): url is string => url !== null);
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
    return {
      output: await runtime.ai.complete({
        prompt: parts.join('\n\n'),
        system: instruction ? `${settings.systemPrompt}\n\n${instruction}` : settings.systemPrompt,
        provider: settings.provider,
        model: settings.model,
        temperature: settings.temperature,
        ...(images.length ? { images } : {}),
      }),
    };
  }
}

/** What the node was told to ask for, as a sentence the model can follow. */
function formatInstruction(settings: AiConfig): string {
  if (settings.outputFormat === 'custom') return settings.outputFormatPrompt;
  if (settings.outputFormat === 'json') return 'Respond with JSON and nothing else.';
  if (settings.outputFormat.startsWith('csv')) return 'Respond with CSV and nothing else.';
  return '';
}

const IMAGE_SUFFIX = /\.(png|jpe?g|gif|webp|bmp)$/i;

/** An image path or data URL, or null for anything that is just text. */
function asImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith('data:image/')) return value;
  return IMAGE_SUFFIX.test(value) ? value : null;
}
