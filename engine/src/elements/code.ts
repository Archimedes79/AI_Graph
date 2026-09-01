import { NodeElement, type Runtime } from '../element.ts';
import { Logic, logicFrom } from '../logic.ts';
import type { GraphNode } from '../graph.ts';

/** What a code node stores. Its own fields, and no one else's. */
export interface CodeConfig {
  code: string;
  /** The file this body is kept in, beside the graph. Empty means "inside the JSON". */
  codeFile: string;
}

/**
 * A node whose behaviour someone wrote.
 *
 * The body is `run(inputs) -> outputs`, both plain JSON objects keyed by port
 * id. JavaScript, and only JavaScript: it is the one language a recipient
 * already has once they have the engine, so a bundle asks for Node and nothing
 * else — no interpreter to find, no packages to install, no second sandbox.
 */
export class CodeElement extends NodeElement<CodeConfig> {
  readonly nodeType = 'code' as const;

  config(node: GraphNode): CodeConfig {
    const c = node.config;
    return {
      code: String(c.code ?? ''),
      codeFile: String(c.code_file ?? ''),
    };
  }

  override logic(node: GraphNode): Logic {
    return logicFrom(node, 'code', { body: 'code', prompt: 'code_prompt', file: 'code_file' },
                     "this node's code");
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
    return logic.run(inputs, runtime.code);
  }
}
