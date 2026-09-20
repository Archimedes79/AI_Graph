import { NodeElement } from '../../NodeElement.ts';
import type { TextFile, WhatRuns } from '../../Element.ts';
import { type Runtime } from '../../Runtime.ts';
import { Logic, logicFrom } from '../../../authoring/logic.ts';
import type { GraphNode } from '../../../graph.ts';
import type { LogicFields } from '../../../authoring/logic.ts';
import type { Generation } from '../../../authoring/generation.ts';

/** What a code node stores. Its own fields, and no one else's. */
const CODE_FIELDS: LogicFields = { body: 'code', prompt: 'code_prompt' };

export interface CodeConfig {
  code: string;
}

/** What this keeps in files of its own in a project folder: see `Element.texts`. */
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
export class CodeNodeElement extends NodeElement<CodeConfig> {
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

  override whatRuns(): WhatRuns {
    return { by: 'body', where: 'code.js', does: 'Calls run(inputs, node) in code.js, sandboxed, and hands on the object it returns, keyed by output port.' };
  }

  /** Written against the node's own ports: `inputs`/`outputs` are left unset,
   *  which means "whatever this node is actually wired as". */
  override generation(): Generation {
    return {
      kind: 'code', fields: CODE_FIELDS,
      guard: 'Please add a code generation prompt first.',
      success: '✅ Code generated!',
    };
  }
}
