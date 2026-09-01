// Running a node once per item instead of once for the list.
//
// Three rules, and every one of them was found by running the same graph
// through this engine and the older one and diffing:
//
// **The size comes from the ports, not from the values.** A node fans out over
// its *declared-multi* inputs; a list arriving on a single-valued port is one
// value that happens to be a list. Guessing from the shape instead means a node
// that takes a list as one argument silently runs once per element of it.
//
// **An empty list is zero runs, not one.** A folder with no files should
// produce no results, and a body that has never seen an empty batch should
// never be asked to handle one.
//
// **A batch of one is not a fan-out.** Its scalar outputs stay scalar, so
// per-item and whole-list agree wherever there was nothing to fan out.

import type { GraphNode } from './graph.js';

/** One set of inputs per item, broadcasting whatever is not being fanned out. */
export function batchItems(
  node: GraphNode,
  inputs: Record<string, unknown>,
): Record<string, unknown>[] {
  const multi = new Set(node.inputs.filter((p) => p.multi).map((p) => p.id));
  const lengths = Object.entries(inputs)
    .filter(([key, value]) => multi.has(key) && Array.isArray(value))
    .map(([, value]) => (value as unknown[]).length);
  const size = lengths.length ? Math.max(...lengths) : 1;

  return Array.from({ length: size }, (_, index) => {
    const item: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputs)) {
      item[key] = multi.has(key) && Array.isArray(value)
        ? (index < value.length ? value[index] : null)
        : value;
    }
    return item;
  });
}

/** Collect one result per item, flattening only the ports declared multi. */
export function mergeBatchOutputs(
  node: GraphNode,
  results: Record<string, unknown>[],
): Record<string, unknown> {
  const multi = new Set(node.outputs.filter((p) => p.multi).map((p) => p.id));
  const merged: Record<string, unknown> = {};
  const single = results.length === 1;

  for (const result of results) {
    for (const [key, value] of Object.entries(result ?? {})) {
      if (single && !multi.has(key)) {
        merged[key] = value;
        continue;
      }
      const target = (merged[key] ??= []) as unknown[];
      if (multi.has(key) && Array.isArray(value)) target.push(...value);
      else target.push(value);
    }
  }
  return merged;
}

/**
 * Line a body's return value up with the ports the node declares.
 *
 * A body that returns keys matching none of them, on a node with exactly one
 * output, meant the whole object — `return {"count": 3}` from a node whose port
 * is called `output`. Wrapping it is what everyone expects; dropping it is what
 * happened before anyone wrote this down. With several ports there is no honest
 * guess, so the value passes through and the mismatch shows up downstream.
 */
export function reconcileOutputs(
  node: GraphNode,
  result: Record<string, unknown>,
): Record<string, unknown> {
  const portIds = node.outputs.map((p) => p.id);
  if (!result || typeof result !== 'object' || !portIds.length) return result;
  if (portIds.some((id) => id in result)) return result;
  if (portIds.length === 1) return { [portIds[0]]: result };
  return result;
}
