import { NodeElement, type AuthoredFile, type Runtime } from '../element.js';
import type { GraphNode } from '../graph.js';
import { batchItems, mergeBatchOutputs, reconcileOutputs } from '../batching.js';

/** What a code node stores. Its own fields, and no one else's. */
export interface CodeConfig {
  code: string;
  language: string;
  requirements: string[];
  /** Read wired file paths into their content before the body sees them. */
  readFileInputs: boolean;
  /** Run once per item of a list input instead of once for the whole list. */
  perItem: boolean;
  batchConcurrency: number;
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
      readFileInputs: c.read_file_inputs === true,
      perItem: c.batch_mode === 'per_item',
      batchConcurrency: Number(c.batch_concurrency ?? 0) || 4,
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

    const resolved = settings.readFileInputs
      ? await readFileInputs(node, inputs, runtime)
      : inputs;

    if (settings.perItem) return runPerItem(node, resolved, runtime, settings);
    return reconcileOutputs(
      node,
      await runtime.code.run(settings.code, settings.language, resolved, settings.requirements),
    );
  }
}

/**
 * Replace wired file paths with their content, for a node that asked.
 *
 * Only ports typed `file_path`: a node reading *every* string input as a
 * filename would break the moment someone wired a sentence into it.
 */
export async function readFileInputs(
  node: GraphNode,
  inputs: Record<string, unknown>,
  runtime: Runtime,
): Promise<Record<string, unknown>> {
  const ports = new Map(node.inputs.map((p) => [p.id, p]));
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputs)) {
    const port = ports.get(key);
    if (!port || port.data_type !== 'file_path' || value === null || value === undefined) {
      resolved[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      resolved[key] = await Promise.all(value.map((path) => runtime.files.read(String(path))));
    } else {
      resolved[key] = await runtime.files.read(String(value));
    }
  }
  return resolved;
}

/**
 * Run the body once per item, bounded.
 *
 * A failing item contributes null on every output port, keeping the results
 * index-aligned with their inputs, and its message is collected rather than
 * ending the batch: one bad row out of two thousand should cost one row.
 */
async function runPerItem(
  node: GraphNode,
  inputs: Record<string, unknown>,
  runtime: Runtime,
  settings: CodeConfig,
): Promise<Record<string, unknown>> {
  const items = batchItems(node, inputs);
  const produced: Record<string, unknown>[] = new Array(items.length);
  let done = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try {
        produced[index] = reconcileOutputs(
          node,
          await runtime.code.run(settings.code, settings.language, items[index], settings.requirements),
        );
      } catch (error) {
        produced[index] = Object.fromEntries(node.outputs.map((p) => [p.id, null]));
        runtime.report?.({
          type: 'activity',
          node_id: node.id,
          message: `item ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      runtime.report?.({ type: 'batch', node_id: node.id, done: ++done, total: items.length });
    }
  };

  const workers = Math.max(1, Math.min(settings.batchConcurrency, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return mergeBatchOutputs(node, produced);
}
