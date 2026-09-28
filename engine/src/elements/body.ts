// One way to run a body.
//
// A body is JavaScript somebody wrote, or a model did: a code node's `code.js`.
// It runs one way, and the probe that tries generated code runs it the same way:
//
//   async function run(inputs, node) { …; return { <output port>: value }; }
//
// - `inputs` is what arrived, keyed by port.
// - `node` holds `node.llm(...)`, a question put to the process that holds
//   the graph. Every body may ask; none ever holds a key.
// - It runs in a process of its own (`host/node.ts`: no child processes, no
//   addons, no workers), and what it returns is the element's output.
//
// The element decides *when* its body runs and what happens to a failure; this
// is the only place that decides *how*.

import type { Runtime } from './Runtime.ts';
import { PLAIN_ASK, llmCall, type AskSettings } from './nodes/ai/ask.ts';

export interface BodyGiven {
  /** What `node.llm` falls back on for whatever a call does not say. The one AI setting, if nothing is given. */
  ask?: AskSettings;
  /**
   * Ends the body. Inside a run the executor sees to that for every body at
   * once; whoever runs one outside a run -- the probe of generated code -- has
   * only this.
   */
  signal?: AbortSignal;
}

export function runBody(
  body: string,
  inputs: Record<string, unknown>,
  runtime: Runtime,
  given: BodyGiven = {},
): Promise<Record<string, unknown>> {
  return runtime.code.run(body, inputs, given.signal, { calls: { llm: llmCall(given.ask ?? PLAIN_ASK, runtime) } });
}
