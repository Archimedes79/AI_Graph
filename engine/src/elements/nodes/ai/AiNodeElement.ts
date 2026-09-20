import { NodeElement } from '../../NodeElement.ts';
import type { TextFile, WhatRuns } from '../../Element.ts';
import { type Runtime } from '../../Runtime.ts';
import { Logic, logicFrom } from '../../../authoring/logic.ts';
import type { GraphNode } from '../../../graph.ts';
import type { LogicFields } from '../../../authoring/logic.ts';
import type { Generation } from '../../../authoring/generation.ts';
import { runBody } from '../../body.ts';
import { askModel, type AskSettings } from './ask.ts';
import { AI_RUN, AI_RUN_TEMPLATES, isStandardRun } from './runTemplate.ts';

/** Where an ai node keeps its two halves; used by both declarations below. */
const PROMPT_FIELDS: LogicFields = {
  body: 'system_prompt', prompt: 'description', promptOnSubject: true,
};

export interface AiConfig extends AskSettings {
  /** `run.js` when somebody changed it; empty for the standard one, whatever its age. */
  runCode: string;
}

/** One per line, or a list: both are what a person would write. */
function serverList(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : String(raw ?? '').split(/\r?\n/);
  return entries.map((entry) => String(entry).trim()).filter(Boolean);
}

/** What this keeps in files of its own in a project folder: see `Element.texts`. */
const AI_TEXTS: readonly TextFile[] = [
  // What the node does with the rest of this folder: see `runTemplate.ts`.
  { field: 'run_code', file: 'run.js', standard: AI_RUN, earlier: AI_RUN_TEMPLATES },
  { field: 'system_prompt', file: 'system.md' },
  { field: 'prompt_template', file: 'message.md' },
  // What the model is told its answer must look like.
  { field: 'output_format_prompt', file: 'output.md' },
  { field: 'output_example', file: 'output.example.md' },
  // What came out of a run, kept: every later run is held to it. Worth having once
  // `run.js` returns more than the one answer.
  { field: 'output_schema', file: 'output.schema.json', json: true },
  // Optional: inputs, and what the answer must meet. See `execution/examples.ts`.
  { field: 'examples', file: 'examples.md' },
];

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
export class AiNodeElement extends NodeElement<AiConfig> {
  readonly nodeType = 'ai' as const;

  override texts(): readonly TextFile[] {
    return AI_TEXTS;
  }

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
      runCode: isStandardRun(String(c.run_code ?? '')) ? '' : String(c.run_code),
    };
  }

  /**
   * The system prompt is what someone writes for an ai node -- markdown. The
   * script that makes the call is `run.js`, and it is not a second copy of the
   * provider layer: it asks for the call (`node.llm`) and the provider layer
   * makes it.
   */
  override logic(node: GraphNode): Logic {
    // The request is the node's own description, not a config field: an ai
    // node's description IS what you asked the model to be.
    return logicFrom(node, 'prompt', PROMPT_FIELDS);
  }

  /** What is wired in is the question: with all of it empty there is nothing to ask. */
  override needsInput(): boolean {
    return true;
  }

  /**
   * The standard `run.js` is one call, and is made here rather than by starting
   * a process to make it: same function, same request (a test holds them to
   * that), without a process per item of a thousand-row batch. A `run.js`
   * somebody changed is a body like any other: it runs where bodies run, and
   * asks for its calls.
   */
  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const settings = this.config(node);
    const order = node.inputs.map((port) => port.id);
    if (!settings.runCode) return { output: await askModel(settings, inputs, runtime, order) };

    return runBody(settings.runCode, inputs, runtime, {
      data: {
        texts: {
          system: settings.systemPrompt, message: settings.template,
          output: settings.outputFormatPrompt, output_example: settings.outputExample,
        },
      },
      ask: settings,
      order,
    });
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override whatRuns(node: GraphNode): WhatRuns {
    return isStandardRun(this.config(node).runCode)
      ? { by: 'engine', where: 'run.js', does: 'Makes the one model call run.js describes -- system.md, message.md filled from the inputs -- and hands on the answer as "output". Unchanged, run.js is made by the engine itself; a test holds the two to the same request.' }
      : { by: 'body', where: 'run.js', does: 'Calls run(inputs, node) in run.js, sandboxed; each node.llm(...) in it is a model call made for it by the process that holds the keys.' };
  }

  override readonly asksModel = true;

  /** The one element whose request lives on the node rather than in its config. */
  override generation(): Generation {
    return {
      kind: 'prompt', fields: PROMPT_FIELDS,
      guard: 'Please add a description first.',
      success: '✅ Prompt generated!',
    };
  }

  override deployNeeds() {
    return { needsInterface: false, asksAi: true };
  }
}
