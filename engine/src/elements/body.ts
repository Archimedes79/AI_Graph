// One way to run a body.
//
// A body is JavaScript somebody wrote, or a model did: a code node's `code.js`,
// an ai node's changed `run.js`, the `select.js` that picks files, the code a
// display block shapes its value with. They are one kind of thing and run one
// way, whichever element they belong to:
//
//   async function run(inputs, node) { …; return { <output port>: value }; }
//
// - `inputs` is what arrived, keyed by port.
// - `node` is what the element hands its body: plain data (an ai node's
//   `node.texts`), and `node.llm(...)`, a question put to the process that
//   holds the graph. Every body may ask; none ever holds a key.
// - It runs in a process of its own (`host/node.ts`: no child processes, no
//   addons, no workers), and what it returns is the element's output.
//
// The element decides *when* its body runs and what happens to a failure; this
// is the only place that decides *how*.

import type { Runtime } from './Runtime.ts';
import { PLAIN_ASK, llmCall, type AskSettings } from './nodes/ai/ask.ts';

export interface BodyGiven {
  /** Plain data the body sees as `node.<key>`. */
  data?: Record<string, unknown>;
  /** What `node.llm` falls back on for whatever a call does not say. The graph's defaults, if nothing is given. */
  ask?: AskSettings;
  /** The element's input ports, in order: how `node.llm` lists inputs a message does not place. */
  order?: string[];
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
  return runtime.code.run(body, inputs, given.signal, {
    data: given.data ?? {},
    calls: { llm: llmCall(given.ask ?? PLAIN_ASK, runtime, given.order) },
  });
}
