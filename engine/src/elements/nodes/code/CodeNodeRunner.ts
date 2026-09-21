import { NodeRunner } from '../../NodeRunner.ts';
import type { TextFile, WhatRuns } from '../../ElementRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { Logic, logicFrom } from '../../../authoring/logic.ts';
import type { GraphNode } from '../../../graph.ts';
import type { LogicFields } from '../../../authoring/logic.ts';
import type { Generation } from '../../../authoring/generation.ts';
import type { Problem } from '../../../execution/wiring.ts';

/** What a code node stores. Its own fields, and no one else's. */
const CODE_FIELDS: LogicFields = { body: 'code', prompt: 'code_prompt' };

export interface CodeConfig {
  code: string;
}

/** What this keeps in files of its own in a project folder: see `ElementRunner.texts`. */
const CODE_TEXTS: readonly TextFile[] = [
  { field: 'code', file: 'code.js' },
  { field: 'code_prompt', file: 'task.md' },
  // The output interface, set from a run: see `execution/interface.ts`.
  { field: 'output_schema', file: 'output.schema.json', json: true },
  // Optional: inputs, and the outputs they must give. See `execution/examples.ts`.
  { field: 'examples', file: 'examples.md' },
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
    // answered by the process that holds the keys, on the graph's default model.
    return logic.run(inputs, runtime);
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override graphAuthorNote(): string {
    return `config.code holds JavaScript as "function run(inputs) { ... }", returning an object whose keys are exactly this node's output port ids. config.code_prompt is the request it was written from. Use only what Node has built in; there is no package manager. The function may be async and is handed a second argument, node: "await node.llm({ prompt: '...' })" asks the graph's model a question and resolves to its answer as text -- use it when code has to decide what to ask, or ask in a loop; for one question, use an ai node instead.`;
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
   * The one thing a node must be told about drawing.
   *
   * A node runs when the *graph* runs; a window changes size when someone
   * *drags* it. The two moments have nothing to do with each other, so a node
   * cannot know how big the chart it is feeding will be -- and a node asked to
   * "draw a chart" writes SVG against a guessed width and height, which is
   * then scaled into whatever the block really is. The flagship plotting
   * example did exactly this: 175 lines of SVG built for 720x340, stretched
   * into a block measured at 1084x470.
   *
   * So the contract says where the line is. A node produces what to show; the
   * block it feeds decides how that looks, because the block is the only one
   * of the two that is there when the window changes.
   *
   * Written against the node's own ports: `inputs`/`outputs` are left unset,
   * which means "whatever this node is actually wired as".
   */
  override generation(): Generation {
    return {
      kind: 'code', fields: CODE_FIELDS,
      contract:
        'If this node feeds a chart block, return the data to plot, NOT a drawing. A '
        + 'chart takes either a list of points -- numbers, or {"label": string, "value": '
        + 'number} -- or an object {"kind": "bars"|"columns"|"line"|"donut", "title": '
        + 'string, "points": [...]}, and draws it at the real size of the block, in the '
        + 'colours of the page. Do not build SVG here: this code runs when the graph '
        + 'runs, so it cannot know how large the block is or which colour scheme it is '
        + 'in, and a drawing made for a guessed size is stretched to fit. The same goes '
        + 'for an image block: return a path or a URL, not pixels.',
      guard: 'Please add a code generation prompt first.',
      success: '✅ Code generated!',
    };
  }
}
