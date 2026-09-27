// What a data node holds, and how that reads to other nodes.

import type { GraphNode } from '@/graph';

export type DataKind = GraphNode['config']['data_format'];

/**
 * Text or structure, as the value itself shows where it can: a list, an object,
 * a number that a run left in a node set to Text is structure all the same, and
 * the node is described and edited as what it holds. Only a string -- which may
 * be either -- and nothing at all are taken as the setting says.
 */
export function dataKind(node: GraphNode): DataKind {
  const value = node.config.data_value;
  if (value !== null && value !== undefined && typeof value !== 'string') return 'structure';
  return node.config.data_format === 'structure' ? 'structure' : 'text';
}

/** Its kind, and what it holds in its own words -- its description -- where it says: `structure: the running total`. */
export function describeDataFormat(node: GraphNode): string {
  const details = node.description?.trim();
  return `${dataKind(node)}${details ? `: ${details}` : ''}`;
}

/** A held value as the box shows it: a string as it is for text, everything else -- a string too, quoted -- as JSON. */
export function asEditableText(value: unknown, kind: DataKind): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && kind === 'text') return value;
  return JSON.stringify(value, null, 2);
}

/**
 * What the box's *text* stores under *kind*: the text itself for Text, the
 * parsed value for Structure -- nothing for an empty box -- or an error when it
 * does not parse. What was typed is never stored as something it is not.
 */
export function storedValue(text: string, kind: DataKind): { value: unknown } | { error: string } {
  if (kind === 'text') return { value: text };
  if (!text.trim()) return { value: null };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: 'Structured data must be valid JSON.' };
  }
}

/**
 * The held value, converted for a switch to *kind*: to text, it becomes its
 * JSON; to structure, a string is parsed when it can be and an empty one is
 * nothing. What cannot be parsed stays the string it was, and the box says so.
 */
export function convertedValue(value: unknown, kind: DataKind): unknown {
  if (kind === 'text') return value === null || value === undefined || typeof value === 'string' ? value ?? '' : JSON.stringify(value, null, 2);
  if (typeof value !== 'string') return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
