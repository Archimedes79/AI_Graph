// The prompts a node is written with, and the one an ai node runs with: the
// standard texts, and the variables they name.
//
// A node says what should happen in its heading and its text; everything else
// is generated. Each ✨ -- the node's input definition, its output definition,
// its body -- is sent a prompt that puts the text together with what the node
// and the graph already hold, through variables:
//
//     {Node Description}   "# <heading> (ID <id>, <kind> node)", then the text
//     {Input Definition}   input.js as it is -- or, while there is none, each input
//     {Output Definition}  output.js as it is -- or, while there is none, each output
//     {Context}            the graph around the node, in words (the editor builds it)
//     {Example File}       for ✨ Input: the start of the file it is given, and its path
//
// **These are the standard prompts, and a node may keep its own.** The editor
// shows each under the ✨ it belongs to, and a node keeps one only when someone
// changed it (`config.prompts.input | output | body`). After it the engine adds
// its own frame, which is not the person's to edit: the file format and how to
// answer (`host/editor/generate.ts`).
//
// **Variables are filled by their exact names**, and nothing else in braces is
// touched: a prompt that holds JSON reaches the model as it was written. A
// variable nothing fills stays as written too -- an ai node's prompt.md is
// filled at run time with the two that mean something then.

/** What a prompt may name, each filled with what the node and the graph hold. */
export const VARIABLES = ['Node Description', 'Input Definition', 'Output Definition', 'Context', 'Example File'] as const;

export type Variable = (typeof VARIABLES)[number];

/**
 * What a ✨ writes: a node's input definition, its output definition, or its
 * body -- code, an ai node's prompt, a data node's data -- each with a
 * standard prompt of its own.
 */
export type PromptKind = 'input' | 'output' | 'code' | 'prompt' | 'data';

const DESCRIBED = 'This is the user\'s node description:\n{Node Description}';

export const STANDARD_PROMPTS: Record<PromptKind, string> = {
  input: `${DESCRIBED}

Context:
{Context}

Example file:
{Example File}

Task: write this node's input definition -- what arrives on each of its inputs, in general: the format any such input has, not only this one example -- and one small, realistic example of it, drawn from the example file where there is one.`,

  output: `${DESCRIBED}

Input definition:
{Input Definition}

Context:
{Context}

Task: write this node's output definition -- what goes out on each of its outputs, fitting what the nodes it feeds want and the context -- and one example of it: what this node gives for the example input.`,

  code: `${DESCRIBED}

Input definition:
{Input Definition}

Output definition:
{Output Definition}

Context:
{Context}

Task: write the code from the description, following the input example and the output definition.`,

  prompt: `${DESCRIBED}

Input definition:
{Input Definition}

Output definition:
{Output Definition}

Context:
{Context}

Task: write the instructions a model is given to do this task with the input it is sent, and to map the data onto the output definition.`,

  data: `${DESCRIBED}

What it feeds:
{Output Definition}

Context:
{Context}

Task: write the data this node holds, shaped as the nodes it feeds want it.`,
};

const VARIABLE = new RegExp(`\\{(${VARIABLES.join('|')})\\}`, 'g');

/** *text* with each variable *values* has replaced by its value; every other `{…}` as it was written. */
export function fillPrompt(text: string, values: Partial<Record<Variable, string>>): string {
  // A function, not a string: a value holding "$&" is put in as it is.
  return text.replace(VARIABLE, (whole, name: Variable) => values[name] ?? whole);
}

/** What a node is, as {Node Description} says it: its heading, its id and kind, then its text. */
export function nodeDescription(node: { id: string; label: string; description: string; node_type: string }): string {
  const heading = `# ${node.label.trim() || node.id} (ID ${node.id}, ${node.node_type} node)`;
  const text = node.description.trim();
  return text ? `${heading}\n\n${text}` : heading;
}

/**
 * The instructions an ai node runs with while its prompt.md says nothing of
 * its own: its description, and what to answer with. With an output
 * definition the answer is JSON keyed as its example is, which the node hands
 * on key by key; without one it is plain text, on the one output.
 */
export function standardRunPrompt(answersJson: boolean): string {
  return answersJson
    ? '{Node Description}\n\nDo this with the input below, and answer with the data mapped onto this output definition -- only JSON, keyed as in its example:\n{Output Definition}'
    : '{Node Description}\n\nDo this with the input below. Answer in plain text.';
}
