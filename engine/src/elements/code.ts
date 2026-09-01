import { NodeElement, type AuthoredFile, type Runtime } from '../element.ts';
import type { GraphNode } from '../graph.ts';

/** What a code node stores. Its own fields, and no one else's. */
export interface CodeConfig {
  code: string;
  language: string;
  requirements: string[];
  /** The file this body is kept in, beside the graph. Empty means "inside the JSON". */
  codeFile: string;
}

/**
 * A node whose behaviour someone wrote.
 *
 * The body is `run(inputs) -> outputs`, both plain JSON objects keyed by port
 * id — the same shape in Python and in JavaScript, so the language is a
 * property of the body rather than a different contract.
 */
export class CodeElement extends NodeElement<CodeConfig> {
  readonly nodeType = 'code' as const;

  config(node: GraphNode): CodeConfig {
    const c = node.config;
    return {
      code: String(c.code ?? ''),
      language: String(c.language ?? 'python'),
      requirements: Array.isArray(c.requirements) ? c.requirements.map(String) : [],
      codeFile: String(c.code_file ?? ''),
    };
  }

  override authoredFile(node: GraphNode): AuthoredFile {
    const language = this.config(node).language;
    return {
      bodyField: 'code',
      nameField: 'code_file',
      extension: language.startsWith('js') || language.startsWith('node') || language.startsWith('javascript') ? '.js' : '.py',
      what: "this node's code",
    };
  }

  override deployNeeds(node: GraphNode) {
    return { requirements: this.config(node).requirements, needsInterface: false };
  }

  async execute(
    node: GraphNode,
    inputs: Record<string, unknown>,
    runtime: Runtime,
  ): Promise<Record<string, unknown>> {
    const settings = this.config(node);
    if (!settings.code.trim()) {
      throw new Error(`${node.label || node.id}: this code node has no code to run.`);
    }

    // Once, for whatever it was handed. Fanning out and reading wired files
    // into their content are the executor's business (see `batchMode` and
    // `readsFileInputs`), so this stays one call.
    return runtime.code.run(settings.code, settings.language, inputs, settings.requirements);
  }
}
