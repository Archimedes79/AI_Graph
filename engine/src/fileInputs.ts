// Handing an element a file's content instead of its name.
//
// A node that says `read_file_inputs` wants the text, not the path — a summary
// of three stories, not a summary of three filenames. The executor does it, for
// any element that asks, which is why an AI node and a code node behave the
// same here without either implementing it.
//
// **Only ports typed `file_path`.** A node that read every string input as a
// filename would break the moment someone wired a sentence into it, and the
// error would arrive as "no such file: Once upon a time".

import type { GraphNode } from './graph.ts';
import type { Runtime } from './element.ts';

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
    resolved[key] = Array.isArray(value)
      ? await Promise.all(value.map((path) => runtime.files.read(String(path))))
      : await runtime.files.read(String(value));
  }
  return resolved;
}
