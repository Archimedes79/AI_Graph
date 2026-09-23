// What an ai node actually sends, put together in one place.
//
// A request has three parts and a person should be able to see all three:
//
//   the instructions   -- the system prompt someone wrote, or had written
//   the message        -- what arrived on the wires, laid out by a template
//   the answer's shape -- the sentence the declared output format becomes
//
// This used to be a loop inside `execute`, which is fine for running and
// useless for showing: the editor could display the system prompt and nothing
// else, so "what does the model get when I wire two things in" was answered by
// running the graph and guessing from the reply. Pulled out, the editor calls
// the same function with the last run's values and shows the request itself --
// a preview that cannot flatter, because it is not a second implementation.
//
// **Nothing wired in is ever dropped.** A template that names one port out of
// two still sends the second, after the template's own text. The alternative
// -- a port that silently stops reaching the model because someone wrote a
// sentence -- is the failure this whole file exists to make impossible. It is
// also why an ai node nobody has written anything for still works: no
// template means "send what arrived".

/** Everything wired in that the template did not place by name. */
export const ALL_INPUTS = 'input';

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

export interface PromptSettings {
  systemPrompt: string;
  /** The message, with `{{port}}` where a port's value goes. Empty: send what arrived. */
  template: string;
  outputFormat: string;
  outputFormatPrompt: string;
  /** An answer to imitate, when the format was learned from a run rather than described. */
  outputExample: string;
}

export interface AssembledPrompt {
  system: string;
  user: string;
  /** Names the template asks for that nothing is wired to. For the editor to say so. */
  unknown: string[];
  /** Ports sent after the template because it did not place them. */
  appended: string[];
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

/** Which names a template asks for, in the order it asks. */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

/**
 * What the node was told to ask for, as sentences the model can follow.
 *
 * The description of the answer -- `output.md` in a project -- is sent
 * whenever it says anything, whatever format is picked: it is what the person
 * wrote for the model about its output, and a file somebody wrote for the
 * model that the model never sees is a trap. The format adds its own sentence
 * in front: JSON, CSV, or the example to imitate -- which, like the
 * description, is sent whenever there is one.
 */
export function formatInstruction(settings: PromptSettings): string {
  const format = settings.outputFormat;
  const described = settings.outputFormatPrompt.trim();
  let rule = '';
  // An example is followed whenever one was kept, whatever the format says:
  // it was kept to be followed, and sent only under one setting it was a
  // file the model never saw.
  if (settings.outputExample.trim()) {
    rule = 'Answer in exactly the same format as this example -- the same structure, '
      + `the same fields, new content:\n\n${settings.outputExample.trim()}`;
  } else if (format === 'json') {
    rule = 'Respond with JSON and nothing else.';
  } else if (format.startsWith('csv')) {
    rule = 'Respond with CSV and nothing else.';
  }
  return [rule, described].filter(Boolean).join('\n\n');
}

/**
 * The request, from the node's settings and what the wires delivered.
 *
 * `inputs` is in port order and holds text-bound values only: an image that is
 * sent as an image has already been taken out by the caller.
 */
export function assemblePrompt(settings: PromptSettings, inputs: Record<string, unknown>): AssembledPrompt {
  const present = Object.entries(inputs).filter(([, value]) => value !== null && value !== undefined);
  const byName = new Map(present);
  const template = settings.template.trim() || `{{${ALL_INPUTS}}}`;

  const asked = placeholders(template);
  const named = new Set(asked.filter((name) => byName.has(name)));
  // `{{input}}` is "the rest" unless a port really is called `input`.
  const wantsRest = asked.includes(ALL_INPUTS) && !byName.has(ALL_INPUTS);
  const rest = present.filter(([name]) => !named.has(name));
  const restText = rest.map(([, value]) => promptText(value)).filter(Boolean).join('\n\n');

  const unknown: string[] = [];
  let user = template.replace(PLACEHOLDER, (_whole, name: string) => {
    if (byName.has(name)) return promptText(byName.get(name));
    if (name === ALL_INPUTS) return restText;
    unknown.push(name);
    return '';
  }).trim();

  const appended = wantsRest ? [] : rest.map(([name]) => name);
  if (!wantsRest && restText) user = user ? `${user}\n\n${restText}` : restText;

  const instruction = formatInstruction(settings);
  const system = [settings.systemPrompt.trim(), instruction].filter(Boolean).join('\n\n');
  return { system, user, unknown: [...new Set(unknown)], appended };
}
