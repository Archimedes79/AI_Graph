import { NodeElement, type Runtime } from '../element.ts';
import type { GraphNode } from '../graph.ts';

export interface AiConfig {
  systemPrompt: string;
  provider: string;
  model: string;
  temperature: number;
  sendImages: boolean;
  readFileInputs: boolean;
  perItem: boolean;
  batchConcurrency: number;
  /** What the model is told to produce. A generation input, not a runtime check. */
  outputFormat: string;
  outputFormatPrompt: string;
}

/**
 * A node that asks a model.
 *
 * The prompt is whatever arrives on `prompt`; anything on `context` is appended
 * under a heading, which is the one piece of prompt assembly the engine does —
 * everything else about the wording belongs to the person who wrote it.
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
      readFileInputs: c.read_file_inputs === true,
      perItem: c.batch_mode === 'per_item',
      batchConcurrency: Number(c.batch_concurrency ?? 0) || 4,
      outputFormat: String(c.output_format ?? 'text'),
      outputFormatPrompt: String(c.output_format_prompt ?? ''),
    };
  }

  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const settings = this.config(node);
    const ask = async (item: Record<string, unknown>): Promise<string> => {
      const prompt = [
        String(item.prompt ?? ''),
        item.context ? `\n\nContext:\n${asText(item.context)}` : '',
      ].join('');
      return runtime.ai.complete({
        prompt,
        system: settings.systemPrompt,
        provider: settings.provider,
        model: settings.model,
        temperature: settings.temperature,
        images: settings.sendImages ? asList(item.images) : undefined,
      });
    };

    if (!settings.perItem) return { output: await ask(inputs) };

    const prompts = asList(inputs.prompt);
    const answers: string[] = new Array(prompts.length);
    let next = 0;
    let done = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next++;
        if (index >= prompts.length) return;
        try {
          answers[index] = await ask({ ...inputs, prompt: prompts[index] });
        } catch (error) {
          answers[index] = '';
          runtime.report?.({
            type: 'activity',
            node_id: node.id,
            message: `item ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        runtime.report?.({ type: 'batch', node_id: node.id, done: ++done, total: prompts.length });
      }
    };

    const workers = Math.max(1, Math.min(settings.batchConcurrency, prompts.length));
    await Promise.all(Array.from({ length: workers }, worker));
    return { output: answers };
  }
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(asText).join('\n\n');
  return JSON.stringify(value);
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value === undefined || value === null ? [] : [String(value)];
}
