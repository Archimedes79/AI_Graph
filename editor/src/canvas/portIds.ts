// What a node's port ids must be, for the node dialog to save them.
//
// A port's id is the name a body reads it by and a wire points at, so the
// ports editor lets it be typed freely -- '' and a name another port has are
// steps on the way to the one meant -- and says here, until Save, what would
// be wrong with keeping it.

import type { Port } from '@/graph';
import { ERROR_PORT } from '@engine/execution/wiring.ts';

/**
 * Where the Error output that "catch failures" adds stands among *outputs*,
 * or -1: the last one of that name, while the node catches its failures.
 *
 * It is found by where it stands, not by its name alone. Split off by name,
 * an output the person typed "error" into jumped into the fixed row in the
 * middle of the word, where it could no longer be edited.
 */
export function caughtErrorAt(outputs: Port[], caught: boolean): number {
  if (!caught) return -1;
  for (let at = outputs.length - 1; at >= 0; at -= 1) if (outputs[at].id === ERROR_PORT) return at;
  return -1;
}

/**
 * Why each side's ports cannot be saved as they are named, or ''.
 *
 * Two ports of one name merged: the wire of the one renamed onto the other
 * moved onto it, and the body saw one value. A port with no name was saved,
 * and no body could read it. And an output of the executor's own error port's
 * name is the one "catch failures" adds and fills.
 */
export function portIdProblems(inputs: Port[], outputs: Port[], caught: boolean): { inputs: string; outputs: string } {
  const fixed = caughtErrorAt(outputs, caught);
  const side = (ports: Port[], kind: 'input' | 'output'): string => {
    if (ports.some((port) => !port.id)) return `An ${kind} has no name.`;
    const seen = new Set<string>();
    for (const port of ports) {
      if (seen.has(port.id)) return `Two ${kind}s are both called "${port.id}".`;
      seen.add(port.id);
    }
    return '';
  };
  const reserved = outputs.some((port, at) => at !== fixed && port.id === ERROR_PORT)
    ? `An output cannot be called "${ERROR_PORT}": "catch failures" adds that one.`
    : '';
  return { inputs: side(inputs, 'input'), outputs: reserved || side(outputs, 'output') };
}
