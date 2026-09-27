// What ✨ Generate is sent for a node, as the file the node keeps it in: `prompt.md`.
//
// A node's request is what a person asks for, in their own words. What ✨
// sends with it -- what comes in, what goes out, the graph around the node --
// is laid out by a template in the same file, which the person can read and
// change like the request:
//
//     Input:
//     {Input Needs}
//
//     Output Example:
//     {Output Example}
//
//     Graph Context:
//     {Graph}
//
//     Prompt:
//     Count the words, and the sentences.
//
// **The request is what follows the last line that reads `Prompt:`.** Without
// such a line the whole file is the request: what a graph written by hand, or
// by a model, gives a node -- one sentence -- and it is sent in the standard
// template. A dialog's request box edits only the request; the file is all of it.
//
// **Variables are filled by their exact names**, and nothing else in braces is
// touched: a prompt holding JSON reaches the model as it was written. What
// fills them is the engine's (`host/editor/brief.ts`); so is the frame around
// the filled template, which says what makes an answer usable -- the skeleton
// to complete, the keys to return -- rather than what the person asks.

/** The template a node's `prompt.md` says while nobody has written a request, ending where the request begins. */
export const STANDARD_PROMPT = 'Input:\n{Input Needs}\n\nOutput Example:\n{Output Example}\n\nGraph Context:\n{Graph}\n\nPrompt:\n';

/** What a template may name, each filled by the engine when ✨ sends it. */
export const PROMPT_VARIABLES = ['Input Needs', 'Output Example', 'Graph'] as const;

export type PromptVariable = typeof PROMPT_VARIABLES[number];

/** A line that is `Prompt:` and nothing else but spaces: `[^\S\n]` is a space that does not end the line. */
const MARKER = /^[^\S\n]*Prompt:[^\S\n]*$/gm;

const VARIABLE = new RegExp(`\\{(${PROMPT_VARIABLES.join('|')})\\}`, 'g');

/** Where the request begins in *text*: just after the last `Prompt:` line and its line end, or -1 without one. */
function requestStart(text: string): number {
  let end = -1;
  for (const match of text.matchAll(MARKER)) end = match.index! + match[0].length;
  if (end < 0) return -1;
  return text[end] === '\n' ? end + 1 : end;
}

/** Whether *text* is a template: it has the `Prompt:` line, or names a variable. Otherwise it is a bare request. */
function isTemplate(text: string): boolean {
  return requestStart(text) >= 0 || PROMPT_VARIABLES.some((name) => text.includes(`{${name}}`));
}

/**
 * The request in *text*: what follows its last `Prompt:` line, or all of it
 * when it has none. As written -- not trimmed, so a line break typed at its
 * end in a request box stays there.
 */
export function requestOf(text: string): string {
  const start = requestStart(text);
  return start < 0 ? text : text.slice(start);
}

/**
 * *text* with its request replaced by *request*: what follows the `Prompt:`
 * line. An empty text is the standard template with the request after it; a
 * text without the line is a bare request, and becomes the new one.
 */
export function withRequest(text: string, request: string): string {
  if (!text.trim()) return STANDARD_PROMPT + request;
  const start = requestStart(text);
  if (start < 0) return request;
  const head = text.slice(0, start);
  return `${head}${head.endsWith('\n') ? '' : '\n'}${request}`;
}

/**
 * *text* as it is sent: each `{Name}` of a known variable replaced by what
 * *values* says, and nothing else touched. A bare request -- no `Prompt:` line
 * and no variable -- is sent in the standard template, so a request written
 * anywhere is sent with what the node knows.
 */
export function fillPrompt(text: string, values: Record<PromptVariable, string>): string {
  const template = isTemplate(text) ? text : STANDARD_PROMPT + text;
  // A function, not a string: a value holding "$&" is put in as it is.
  return template.replace(VARIABLE, (_whole, name: PromptVariable) => values[name]);
}
