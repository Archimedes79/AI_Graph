// What an ai node runs, as the file a project folder keeps beside its prompts.
//
// A node's folder shows what the model is told -- system.md, message.md -- and,
// in `run.js`, how: a handful of lines that make the one call, with the detail
// of making it (keys, providers, tools, images, retries) behind `node.llm`,
// where it belongs.
//
// **Left alone, it is the engine's.** A `run.js` that says what this file ships
// means "the standard", and the engine makes that one call itself rather than
// starting a process to make it (`AiNodeRunner.execute` -- and a test holds the
// two to the same request).
//
// **Changed, it is the person's.** It runs where every authored body runs: a
// separate process that may read files and has none of this machine's keys. It
// asks for the model call; it cannot make one.

import { isStandardText } from '../../ElementRunner.ts';

/** How often one run of a body may ask for the model. A loop that forgot to end must not spend a budget. */
export const LLM_CALLS_PER_RUN = 25;

/** The `run.js` a project is given. */
export const AI_RUN = `// ai-graph template: ai@1
//
// What this node does when it runs. It asks the model once: system.md is the
// standing instruction, message.md the message -- its {{port}} placeholders
// filled from the inputs, and whatever it does not name appended -- and the
// node's settings decide the rest (model, temperature, tools, images, output
// format). The answer goes out on the port "output".
//
// Left as it is, this file is kept up to date for you. Change it and it is
// yours: a loop, a second call, a check of the answer. It runs sandboxed and
// without this machine's keys -- node.llm asks for the call to be made, at
// most ${LLM_CALLS_PER_RUN} times a run.
async function run(inputs, node) {
  const output = await node.llm({
    system: node.texts.system,
    message: node.texts.message,
    inputs,
  });
  return { output };
}`;

/** Whether *text* is nobody's own: empty, or the standard. */
export const isStandardRun = (text: string): boolean => isStandardText(text, AI_RUN);
