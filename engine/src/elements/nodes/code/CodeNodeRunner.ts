import { NodeRunner, type TextFile, type WhatRuns } from '../../NodeRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { Logic, logicFrom } from '../../../authoring/logic.ts';
import type { GraphNode } from '../../../graph.ts';
import type { LogicFields } from '../../../authoring/logic.ts';
import type { Generation } from '../../../authoring/generation.ts';
import { STANDARD_PROMPT } from '../../../authoring/promptFile.ts';
import type { Problem } from '../../../execution/wiring.ts';

/** What a code node stores. Its own fields, and no one else's. */
const CODE_FIELDS: LogicFields = { body: 'code', prompt: 'prompt' };

export interface CodeConfig {
  code: string;
}

/**
 * What this keeps in files of its own in a project folder (see
 * `NodeRunner.texts`), in the order a node is built: what comes in, what goes
 * out, what ✨ is asked, and the code.
 */
const CODE_TEXTS: readonly TextFile[] = [
  // Optional: inputs, and the outputs they must give -- the first is the example. See `execution/examples.ts`.
  { field: 'examples', file: 'examples.md' },
  // What goes out, in words: each output, its format, an example of it.
  { field: 'output_format_prompt', file: 'output.md' },
  // What ✨ Generate is sent: the template, then the request. See `authoring/promptFile.ts`.
  { field: 'prompt', file: 'prompt.md', standard: STANDARD_PROMPT },
  // The requests sent before, newest first.
  { field: 'prompt_history', file: 'prompt.history.md' },
  { field: 'code', file: 'code.js' },
];

/**
 * A node whose behaviour someone wrote.
 *
 * The body is `run(inputs) -> outputs`, both plain JSON objects keyed by port
 * id. JavaScript, and only JavaScript: it is the one language a recipient
 * already has once they have the engine, so a bundle asks for Node and nothing
 * else — no interpreter to find, no packages to install, no second sandbox.
 */
export class CodeNodeRunner extends NodeRunner<CodeConfig> {
  readonly nodeType = 'code' as const;

  override readonly keepsOutputInterface = true;

  override texts(): readonly TextFile[] {
    return CODE_TEXTS;
  }

  config(node: GraphNode): CodeConfig {
    const c = node.config;
    return {
      code: String(c.code ?? ''),
    };
  }

  override logic(node: GraphNode): Logic {
    return logicFrom(node, 'code', CODE_FIELDS);
  }

  /** Its body is written for one item, so a list can be handed to it an item at a time. */
  override readonly fansOut = true;

  /** A file on an input that says so arrives as its text: `run` reads no files itself. */
  override readonly readsFileInputs = true;

  async execute(
    node: GraphNode,
    inputs: Record<string, unknown>,
    runtime: Runtime,
  ): Promise<Record<string, unknown>> {
    const logic = this.logic(node);
    if (logic.isEmpty) {
      throw new Error(`${node.label || node.id}: this code node has no code to run.`);
    }

    // Once, for whatever it was handed. Fanning out and reading wired files
    // into their content are the executor's business (see `batchMode` and
    // `readsFileInputs`), so this stays one call.
    //
    // It may ask a model, as an ai node's `run.js` does: `await node.llm({ prompt })`,
    // answered by the process that holds the keys, on the one AI setting's model.
    return logic.run(inputs, runtime);
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override graphAuthorNote(): string {
    return `config.code holds JavaScript as "function run(inputs) { ... }", returning an object whose keys are exactly this node's output port ids. config.prompt is the request it was written from, in a sentence or two of plain words. Use only what Node has built in; there is no package manager. The function may be async and is handed a second argument, node: "await node.llm({ prompt: '...' })" asks the configured model a question and resolves to its answer as text -- use it when code has to decide what to ask, or ask in a loop; for one question, use an ai node instead.`;
  }

  override whatRuns(): WhatRuns {
    return { by: 'body', where: 'code.js', does: 'Calls run(inputs, node) in code.js, sandboxed, and hands on the object it returns, keyed by output port.' };
  }

  override problems(node: GraphNode, _elements: unknown, where: string): Problem[] {
    if (String(node.config.code ?? '').trim()) return [];
    return [{
      where,
      problem: 'A code node with no config.code: it fails the moment it runs.',
      fix: `Put the body in config.code as "function run(inputs) { ... }", returning an object keyed by this node's output port ids.`,
    }];
  }

  /**
   * Written against the node's own ports: `inputs`/`outputs` are left unset,
   * which means "whatever this node is actually wired as".
   *
   * No contract of its own. It used to carry one about charts -- return the
   * data to plot, never a drawing -- and every code node was told it, including
   * the ones that feed a table or nothing at all. That sentence is true of what
   * a *chart* receives, so the chart says it now (`WidgetRunner.receives`), and
   * only a node that is wired into one hears it.
   */
  override generation(): Generation {
    return {
      kind: 'code', fields: CODE_FIELDS,
      guard: 'Say what this node should do first.',
      success: '✅ Code generated!',
    };
  }
}
