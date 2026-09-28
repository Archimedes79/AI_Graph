// The prompts a node is written with, and the one an ai node runs with: the
// standard texts, and the variables they name.
//
// A node says what should happen in its heading and its text; everything else
// is generated. Each ✨ -- the node's input definition, its output definition,
// its body -- is sent a prompt that puts the text together with what the node
// and the graph already hold, through variables (`VARIABLES` says what each
// is filled with; the editor lists them under every prompt it shows).
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

import { textOutput } from './definition.ts';

/** What a prompt may name, and what each is filled with: what the node and the graph hold. */
export const VARIABLES = {
  'Node Description': 'Its heading, id and kind as "# <heading> (ID <id>, <kind> node)", then its text',
  'Input Definition': 'input.js as it is -- or, while there is none, each input: its type, what it is, where it comes from',
  'Output Definition': 'output.js as it is -- or, while there is none, each output and where it goes',
  Context: 'The graph around the node, in words: what it is for, its pages, what is wired to what',
  'Example Files': 'For ✨ Input: the files it is given -- examples, a spec -- each path and the start of it',
  'Output Files': 'For ✨ Output: the files it is given, the same way',
} as const;

export type Variable = keyof typeof VARIABLES;

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

Example files:
{Example Files}

Task: write this node's input definition -- what arrives on each of its inputs, in general: the format any such input has, not only these examples -- and one small, realistic example of it, drawn from the example files where there are some.`,

  output: `${DESCRIBED}

Input definition:
{Input Definition}

Context:
{Context}

Output files:
{Output Files}

Task: write this node's output definition -- what goes out on each of its outputs, fitting what the nodes it feeds want, the context and the output files where there are some -- and one example of it: what this node gives for the example input.`,

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

const VARIABLE = new RegExp(`\\{(${Object.keys(VARIABLES).join('|')})\\}`, 'g');

/** *text* with each variable *values* has replaced by its value; every other `{…}` as it was written. */
export function fillPrompt(text: string, values: Partial<Record<Variable, string>>): string {
  // A function, not a string: a value holding "$&" is put in as it is.
  return text.replace(VARIABLE, (whole, name: Variable) => values[name] ?? whole);
}

/**
 * What a node is, as {Node Description} says it: its heading, its id and kind,
 * then its text. A node always has a heading (`check` names one without), so
 * nothing stands in for it here.
 */
export function nodeDescription(node: { id: string; label: string; description: string; node_type: string }): string {
  const heading = `# ${node.label.trim()} (ID ${node.id}, ${node.node_type} node)`;
  const text = node.description.trim();
  return text ? `${heading}\n\n${text}` : heading;
}

/**
 * The instructions an ai node runs with while its prompt.md says nothing of
 * its own, for its output definition *definition* ('' while it has none): its
 * description, and how to answer. In plain text without a definition, and
 * where it names one output that holds text (`textOutput`): the answer is that
 * text. Where it names several, or a value that is not text, the answer is
 * JSON keyed as its example is, which the node hands on key by key.
 */
export function standardRunPrompt(definition: string): string {
  const start = '{Node Description}\n\nDo this with the input below';
  if (!definition.trim()) return `${start}. Answer in plain text.`;
  if (textOutput(definition) !== undefined) {
    return `${start}. Answer in plain text: the text itself, as this output definition describes it -- not JSON, and not the file.\n{Output Definition}`;
  }
  return `${start}, and answer with the data mapped onto this output definition: only a JSON object, keyed and shaped as its example after module.exports -- not the file itself.\n{Output Definition}`;
}
