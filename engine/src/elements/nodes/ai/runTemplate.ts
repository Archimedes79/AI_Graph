// What an ai node runs, as the file a project folder keeps beside its prompts.
//
// Reading a node's folder used to show what the model is told -- system.md,
// message.md -- and not how: which of them goes where, what happens to the
// inputs, where the answer ends up. That was in the engine. It is `run.js` now,
// in the node's folder: a handful of lines that make the one call, with the
// detail of making it (keys, providers, tools, images, retries) behind
// `node.llm`, where it belongs.
//
// **Left alone, it is the engine's.** A folder written last year holds last
// year's text, and must not pin last year's behaviour. So every text this file
// ever shipped is known here; a `run.js` that is one of them means "the
// standard", is rewritten to the current one when the project is saved, and the
// engine makes that one call itself rather than starting a process to make it
// (`AiNodeElement.execute` -- and a test holds the two to the same request).
//
// **Changed, it is the person's.** It runs where every authored body runs: a
// separate process that may read files and has none of this machine's keys. It
// asks for the model call; it cannot make one.

/** How often one run of a body may ask for the model. A loop that forgot to end must not spend a budget. */
export const LLM_CALLS_PER_RUN = 25;

const V1 = `// ai-graph template: ai@1
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

/** Every standard text there has been, oldest first. Add, never edit: an old folder still holds an old one. */
export const AI_RUN_TEMPLATES: readonly string[] = [V1];

/** The one a project is given today. */
export const AI_RUN = AI_RUN_TEMPLATES[AI_RUN_TEMPLATES.length - 1];

const plain = (text: string): string => text.replace(/\r\n/g, '\n').trim();

/** Whether *text* is nobody's own: empty, or a standard text of any age. */
export function isStandardRun(text: string): boolean {
  const written = plain(text);
  return !written || AI_RUN_TEMPLATES.some((template) => plain(template) === written);
}
