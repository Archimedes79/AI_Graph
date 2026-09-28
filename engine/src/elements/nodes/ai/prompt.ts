// What an ai node actually sends, put together in one place.
//
// A request has two parts, and a person should be able to see both:
//
//   the instructions -- its prompt.md, or the standard while it has none, with
//                       {Node Description} and {Output Definition} filled in
//   the message      -- what arrived on the wires, after them
//
// **Nothing wired in is ever dropped, and nothing is placed by guesswork.** One
// input is sent as it is; several are each sent under their port id, the name
// the node's input definition gives them, so instructions can say "the history"
// and "the message" and the model can tell which is which. It is also why an ai
// node nobody has written anything for still works: its description is the
// question, and what arrived is what it is asked about.

export interface AssembledPrompt {
  system: string;
  user: string;
}

/**
 * One value as the model should read it.
 *
 * A list becomes its items, one per paragraph -- not a serialization of the
 * list, which puts brackets, quotes and commas into the prompt and makes the
 * model read around syntax to find the text. Three summaries wired into a node
 * arrive as three paragraphs.
 */
export function promptText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const items = Array.isArray(value) ? value : [value];
  return items
    .filter((item) => item !== null && item !== undefined)
    .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
    .join('\n\n');
}

/**
 * The request, from the node's filled-in *instructions* and what the wires
 * delivered. *inputs* is in port order and holds text-bound values only: an
 * image that is sent as an image has already been taken out by the caller.
 */
export function assemblePrompt(instructions: string, inputs: Record<string, unknown>): AssembledPrompt {
  const present = Object.entries(inputs).filter(([, value]) => value !== null && value !== undefined);
  const user = present.length === 1
    ? promptText(present[0][1])
    : present.map(([port, value]) => `${port}:\n${promptText(value)}`).join('\n\n');
  const system = instructions.trim();
  // A node with nothing wired in is its instructions and nothing else -- "write
  // a haiku about autumn". Those are the question, then, and go as the message:
  // a request with an empty message is refused by some providers and answered
  // with a guess by others.
  if (!user.trim() && system) return { system: '', user: system };
  return { system, user };
}
