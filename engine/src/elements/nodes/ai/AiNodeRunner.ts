import { NodeRunner, type TextFile, type WhatRuns } from '../../NodeRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { Logic, logicFrom } from '../../../authoring/logic.ts';
import type { GraphNode } from '../../../graph.ts';
import type { LogicFields } from '../../../authoring/logic.ts';
import type { Generation } from '../../../authoring/generation.ts';
import { names, type Problem } from '../../../execution/wiring.ts';
import { STANDARD_PROMPT } from '../../../authoring/promptFile.ts';
import { runBody } from '../../body.ts';
import { askModel, type AskSettings } from './ask.ts';
import { ALL_INPUTS, outputWords, placeholders } from './prompt.ts';
import { AI_RUN, isStandardRun } from './runTemplate.ts';

/** Where an ai node keeps what it is asked and what it writes; used by both declarations below. */
const PROMPT_FIELDS: LogicFields = { body: 'system_prompt', prompt: 'prompt', message: 'message_template' };

/** The one port the answer goes out on. */
const ANSWER = 'output';

export interface AiConfig extends AskSettings {
  /** `run.js` when somebody changed it; empty for the standard one. */
  runCode: string;
}

/** One per line, or a list: both are what a person would write. */
function serverList(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : String(raw ?? '').split(/\r?\n/);
  return entries.map((entry) => String(entry).trim()).filter(Boolean);
}

/**
 * What this keeps in files of its own in a project folder (see
 * `NodeRunner.texts`), in the order a node is built -- the same as a code
 * node's, with the instructions and the message where its code is.
 */
const AI_TEXTS: readonly TextFile[] = [
  // Optional: inputs, and what the answer must meet -- the first is the example. See `execution/examples.ts`.
  { field: 'examples', file: 'examples.md' },
  // What the model is told its answer must look like.
  { field: 'output_format_prompt', file: 'output.md' },
  // What ✨ Generate is sent: the template, then the request. See `authoring/promptFile.ts`.
  { field: 'prompt', file: 'prompt.md', standard: STANDARD_PROMPT },
  // The requests sent before, newest first.
  { field: 'prompt_history', file: 'prompt.history.md' },
  { field: 'system_prompt', file: 'system.md' },
  { field: 'message_template', file: 'message.md' },
  // What the node does with the rest of this folder: see `runTemplate.ts`.
  { field: 'run_code', file: 'run.js', standard: AI_RUN },
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
export class AiNodeRunner extends NodeRunner<AiConfig> {
  readonly nodeType = 'ai' as const;

  override readonly keepsOutputInterface = true;

  override texts(): readonly TextFile[] {
    return AI_TEXTS;
  }

  config(node: GraphNode): AiConfig {
    const c = node.config;
    return {
      systemPrompt: String(c.system_prompt ?? ''),
      provider: String(c.ai_provider ?? ''),
      model: String(c.ai_model ?? ''),
      ...(typeof c.temperature === 'number' ? { temperature: c.temperature } : {}),
      sendImages: c.send_images === true,
      template: String(c.message_template ?? ''),
      outputFormatPrompt: outputWords(c),
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
    return logicFrom(node, 'prompt', PROMPT_FIELDS);
  }

  /** Its body is written for one item, so a list can be handed to it an item at a time. */
  override readonly fansOut = true;

  /** A file on an input that says so is sent as what it says, not as its name. */
  override readonly readsFileInputs = true;

  /** What is wired in is the question: with all of it empty there is nothing to ask. */
  override needsInput(): boolean {
    return true;
  }

  /**
   * The standard `run.js` is one call, and is made here rather than by starting
   * a process to make it: same function, same request (a test holds them to
   * that), without a process per item of a thousand-row batch. A `run.js`
   * somebody changed is a body like any other: it runs where bodies run, and
   * asks for its calls -- and hands on what it returns, as it returns it.
   *
   * An answer on a port typed `json` is the value it writes out (`jsonAnswer`):
   * a node that maps whatever arrives onto a fixed format hands on that
   * format, not a text of it.
   */
  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const settings = this.config(node);
    const order = node.inputs.map((port) => port.id);
    if (!settings.runCode) {
      const answer = await askModel(settings, inputs, runtime, order);
      const json = node.outputs.find((port) => port.id === ANSWER)?.data_type === 'json';
      return { [ANSWER]: json ? jsonAnswer(answer) : answer };
    }

    return runBody(settings.runCode, inputs, runtime, {
      data: {
        texts: { system: settings.systemPrompt, message: settings.template, output: settings.outputFormatPrompt },
      },
      ask: settings,
      order,
    });
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override graphAuthorNote(): string {
    return `config.prompt is the request, in a sentence or two of plain words, and config.system_prompt is the standing instruction written from it. Everything wired into it is sent as the message; with more than one input, lay them out in config.message_template using {{port_id}} placeholders, for example "Conversation so far: {{history}} User: {{message}}" with line breaks between the parts. The reply arrives on the node's single output port, "output"; give that port data_type "json" and the reply is parsed as JSON and handed on as the value, so say in config.output_format_prompt what the JSON holds.`;
  }

  override whatRuns(node: GraphNode): WhatRuns {
    return isStandardRun(this.config(node).runCode)
      ? { by: 'engine', where: 'run.js', does: 'Makes the one model call run.js describes -- system.md, message.md filled from the inputs -- and hands on the answer as "output", parsed as JSON where that port is typed json. Unchanged, run.js is made by the engine itself; a test holds the two to the same request.' }
      : { by: 'body', where: 'run.js', does: 'Calls run(inputs, node) in run.js, sandboxed; each node.llm(...) in it is a model call made for it by the process that holds the keys.' };
  }

  /** A placeholder nobody fills is sent to the model as the literal "{{name}}". */
  override problems(node: GraphNode, _elements: unknown, where: string): Problem[] {
    const template = String(node.config.message_template ?? '');
    if (!template.trim()) return [];
    const inputs = new Set(node.inputs.map((port) => port.id));
    return placeholders(template)
      .filter((name) => name !== ALL_INPUTS && !inputs.has(name))
      .map((name) => ({
        where,
        problem: `Its message template asks for {{${name}}}, and it has no input "${name}".`,
        fix: `Use one of its inputs: ${names(inputs)} -- or add an input with that id.`,
      }));
  }

  /** Its instructions and the message they are sent with, written together from its `prompt.md`. */
  override generation(): Generation {
    return {
      kind: 'prompt', fields: PROMPT_FIELDS,
      guard: 'Say what this node should do first.',
      success: '✅ Prompt generated!',
    };
  }

  /** Always, whatever its body says: asking the model is what this node is. */
  override deployNeeds() {
    return { needsInterface: false, asksAi: true };
  }
}

/**
 * A model's answer as the JSON it is: the value it writes out, with a ```json
 * fence around the whole of it taken off. An answer that is not JSON fails the
 * node, saying how it began -- handed on as text, it reaches the node after it
 * as a string where a record was promised, and fails there, further from why.
 */
function jsonAnswer(answer: string): unknown {
  const said = answer.trim();
  const fenced = /^```[^\n`]*\n([\s\S]*?)\n?[ \t]*```$/.exec(said);
  try {
    return JSON.parse(fenced ? fenced[1] : said);
  } catch {
    const start = said.length > 160 ? `${said.slice(0, 160)}…` : said;
    throw new Error(`The model's answer is not JSON, and this node's output is typed json. It began: "${start}". `
      + 'Say in its output words (output.md) that the answer is JSON and nothing else, or type the output as text.');
  }
}
