import { NodeRunner, type TextFile, type WhatRuns } from '../../NodeRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { Logic, logicFrom } from '../../../authoring/logic.ts';
import type { GraphNode } from '../../../graph.ts';
import type { LogicFields } from '../../../authoring/logic.ts';
import type { Generation } from '../../../authoring/generation.ts';
import { DEFINITION_TEXTS, definitionsIn, type Definitions } from '../../../authoring/definition.ts';
import { fillPrompt, nodeDescription, standardRunPrompt } from '../../../authoring/prompts.ts';
import { askModel, type AskSettings } from './ask.ts';

/** Where an ai node keeps its body: the instructions it runs with, `prompt.md`. */
const PROMPT_FIELDS: LogicFields = { body: 'prompt' };

/** The one port a plain answer goes out on: a node with no output definition has no other. */
const ANSWER = 'output';

/** What {Output Definition} says to a node that has none, where its own prompt names it. */
const NO_DEFINITION = 'None: answer in plain text.';

export interface AiConfig extends AskSettings {
  /** It has an output definition: the answer is JSON, keyed as its example is, and handed on key by key. */
  answersJson: boolean;
}

/** One per line, or a list: both are what a person would write. */
function serverList(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : String(raw ?? '').split(/\r?\n/);
  return entries.map((entry) => String(entry).trim()).filter(Boolean);
}

/**
 * What this keeps in files of its own in a project folder (see
 * `NodeRunner.texts`), in the order a node is built -- the same as a code
 * node's, with the instructions where its code is.
 */
const AI_TEXTS: readonly TextFile[] = [
  ...DEFINITION_TEXTS,
  { field: 'prompt', file: 'prompt.md' },
  { field: 'history', file: 'history.md' },
];

/**
 * A node that asks a model.
 *
 * It is told its instructions -- its prompt.md, or while it has none the
 * standard (`authoring/prompts.ts`), with its description and its output
 * definition filled in -- and then **everything wired into it**, in port order,
 * each input under its port id where there are several (see `prompt.ts`). Not
 * a port named `prompt`: a node with two inputs wired to two different upstream
 * nodes should send both, and naming one of them would make the second
 * silently disappear.
 *
 * With an output definition it maps whatever arrives onto a fixed format: the
 * answer is JSON keyed as the definition's example is, and each key goes out on
 * the output port of that name. Without one the answer is text, on "output".
 *
 * Running once per item is not here. A node that fans out does so the same way
 * a code node does, in the executor, because "run this once per element" is a
 * property of the graph rather than of asking a model.
 */
export class AiNodeRunner extends NodeRunner<AiConfig> {
  readonly nodeType = 'ai' as const;

  override texts(): readonly TextFile[] {
    return AI_TEXTS;
  }

  override definitions(node: GraphNode): Definitions {
    return definitionsIn(node);
  }

  config(node: GraphNode): AiConfig {
    const c = node.config;
    const output = definitionsIn(node).output.trim();
    const own = String(c.prompt ?? '');
    return {
      instructions: fillPrompt(own.trim() ? own : standardRunPrompt(!!output), {
        'Node Description': nodeDescription(node),
        'Output Definition': output || NO_DEFINITION,
      }),
      answersJson: !!output,
      provider: String(c.ai_provider ?? ''),
      model: String(c.ai_model ?? ''),
      ...(typeof c.temperature === 'number' ? { temperature: c.temperature } : {}),
      sendImages: c.send_images === true,
      toolServers: serverList(c.mcp_servers),
    };
  }

  /** Its body is its instructions, prompt.md -- markdown a model is sent, not code that runs. */
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
   * One call, made here: the process that holds the keys makes it. An answer
   * to a node with an output definition is the JSON it writes out, each key on
   * its own port (`jsonAnswer`): a node that maps whatever arrives onto a fixed
   * format hands on that format, not a text of it.
   */
  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const settings = this.config(node);
    const answer = await askModel(settings, inputs, runtime, node.inputs.map((port) => port.id));
    return settings.answersJson ? jsonAnswer(answer) : { [ANSWER]: answer };
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override graphAuthorNote(): string {
    return 'its description says in words what it does; everything wired into it is sent after its instructions, each input '
      + 'under its port id where there are several. config.prompt may hold instructions of its own, with {Node Description} and '
      + '{Output Definition} where the description and the output definition are to go; without it, the node is told its '
      + 'description and to answer. config.output_definition -- a JSDoc typedef, then "module.exports = <one example as plain '
      + 'JSON>;" -- makes the answer JSON keyed as that example is, each key handed on the output port of the same id: declare '
      + 'one output port per key. Without one, the answer is plain text on its one output port, "output".';
  }

  override whatRuns(): WhatRuns {
    return this.engineRuns('Sends prompt.md -- or the standard instructions, while it says nothing of its own -- with its description '
      + 'and output.js filled in, then what arrived, each input under its port id where there are several; with an output.js '
      + 'the answer is parsed as JSON and each key handed on its output port, without one it is text on "output".');
  }

  /** Its instructions, written from its description and definitions. */
  override generation(): Generation {
    return {
      kind: 'prompt', fields: PROMPT_FIELDS,
      guard: 'Say what this node should do first: its text is what its instructions are written from.',
      success: '✅ Prompt written.',
    };
  }

  /** Always, whatever its body says: asking the model is what this node is. */
  override deployNeeds() {
    return { needsInterface: false, asksAi: true };
  }
}

/**
 * A model's answer as the JSON object it is: what the node writes out, key by
 * key, with a ```json fence around the whole of it taken off. An answer that is
 * not a JSON object fails the node, saying how it began -- handed on as text,
 * it reaches the node after it as a string where a record was promised, and
 * fails there, further from why.
 */
function jsonAnswer(answer: string): Record<string, unknown> {
  const said = answer.trim();
  const fenced = /^```[^\n`]*\n([\s\S]*?)\n?[ \t]*```$/.exec(said);
  let value: unknown;
  try {
    value = JSON.parse(fenced ? fenced[1] : said);
  } catch {
    value = undefined;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  const start = said.length > 160 ? `${said.slice(0, 160)}…` : said;
  throw new Error(`The model's answer is not the JSON object this node's output.js asks for. It began: "${start}". `
    + 'Say in its prompt that the answer is that JSON and nothing else, or remove its output.js for a plain text answer.');
}
