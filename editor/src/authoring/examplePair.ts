// A node's one example: what goes in, and what should come out.
//
// It is kept where a node's examples always were, in `examples.md`
// (`config.examples`), as its first `## ` section -- an input block keyed by
// input port, and an expect block. `test` runs it, `check` holds it to the
// wiring, and ✨ Generate is written and tried against it (the engine reads it
// there, `brief.ts#exampleSample`). There is no second store: the dialog's
// step 1 and step 2 are views of this section and nothing else.
//
// A file may hold more than one section, written by hand. Only the first is
// edited here; the rest are kept as they are, and `test` still runs them.
//
// Where a section begins and what its blocks are is the engine's grammar,
// imported rather than copied: what the dialog shows as the example is what
// `test` runs only while the two read the file alike.

import { EXAMPLE_SECTION, exampleBlocks, type ExampleBlock } from '@engine/execution/examples.ts';

/** What a new pair is called, when the file has none yet. */
export const PAIR_TITLE = 'The example';

export interface ExamplePair {
  /** The input block as written, or '' when there is none. */
  inputText: string;
  /** The input block read as an object keyed by port, or undefined when it is missing or is not one. */
  input?: Record<string, unknown>;
  /** The expect block as written, or '' when there is none. */
  expectText: string;
  expect?: Record<string, unknown>;
  /** A sentence a model holds the answer to, where a pair has one instead of an expect block. */
  judge?: string;
  /** The first section's title, or '' when the file has no section. */
  title: string;
  /** How many sections come after the first: kept, and run by `test`. */
  others: number;
  /** An input and something checked: what `test` runs and ✨ is tried on. */
  complete: boolean;
}

type Role = Exclude<ExampleBlock['role'], ''>;

/** The file cut into what comes before the first section, the first section, and the rest. */
function cut(text: string): { before: string; first: string; after: string; others: number } {
  const normal = text.replace(/\r\n/g, '\n');
  const marker = normal.match(EXAMPLE_SECTION);
  if (!marker) return { before: normal, first: '', after: '', others: 0 };
  // The marker's own length, not the three characters of "## ": a heading
  // written with more spaces is cut where the engine splits it.
  const start = marker.index!;
  const rest = normal.slice(start + marker[0].length);
  const next = rest.search(EXAMPLE_SECTION);
  const first = next < 0 ? normal.slice(start) : normal.slice(start, start + marker[0].length + next);
  const after = next < 0 ? '' : rest.slice(next);
  return { before: normal.slice(0, start), first, after, others: after ? after.split(EXAMPLE_SECTION).length - 1 : 0 };
}

/**
 * An example as values: an object keyed by port, or undefined while *text* is
 * empty or is not one -- what `parseExamples` accepts as a block. The one
 * reading of an example's text.
 */
export function exampleObject(text: string | undefined): Record<string, unknown> | undefined {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** The first pair of *text*, as the dialog shows it. */
export function readPair(text: string | undefined): ExamplePair {
  const { first, others } = cut(text ?? '');
  const blocks = exampleBlocks(first);
  const input = blocks.find((block) => block.role === 'input');
  const expect = blocks.find((block) => block.role === 'expect');
  const judge = blocks.find((block) => block.role === 'judge');
  const pair: ExamplePair = {
    inputText: input?.body.trimEnd() ?? '',
    input: input ? exampleObject(input.body) : undefined,
    expectText: expect?.body.trimEnd() ?? '',
    expect: expect ? exampleObject(expect.body) : undefined,
    judge: judge?.body.trim() || undefined,
    title: first ? first.replace(EXAMPLE_SECTION, '').split('\n', 1)[0].trim() : '',
    others,
    complete: false,
  };
  pair.complete = !!pair.input && (!!pair.expect || !!pair.judge);
  return pair;
}

function block(role: Role, body: string): string {
  // A judge is a sentence, not JSON: `parseExamples` reads a bare `judge` block.
  return role === 'judge' ? `\`\`\`judge\n${body.trim()}\n\`\`\`` : `\`\`\`json ${role}\n${body.trim() || '{}'}\n\`\`\``;
}

/** The file again, from its parts: the first section ends in a newline, and a blank line parts it from the next. */
function assemble(before: string, section: string, after: string): string {
  const ended = `${section.trimEnd()}\n`;
  return `${before}${ended}${after ? '\n' : ''}${after}`;
}

/** *first* without its *role* block, the blank lines around it closed up. */
function without(first: string, role: Role): string {
  const own = exampleBlocks(first).find((candidate) => candidate.role === role);
  if (!own) return first;
  return `${first.slice(0, own.start).trimEnd()}\n${first.slice(own.end).replace(/^\n+/, '\n')}`;
}

/** An expect block that names nothing: "only that it runs". */
const checksNothing = (candidate: ExampleBlock): boolean => candidate.role === 'expect' && candidate.body.replace(/\s/g, '') === '{}';

/** Whether *section* still holds an example: an input, or something checked beyond that it runs. */
const holdsExample = (section: string): boolean => exampleBlocks(section).some((candidate) => candidate.role === 'input'
  || candidate.role === 'judge' || (candidate.role === 'expect' && !checksNothing(candidate)));

/**
 * *text* with its first pair's *role* block set to *body*: replaced where it
 * is, added where it belongs when it is not there, and a first section begun
 * when the file has none. Everything else in the file stays as it was.
 *
 * A pair that gets an input and has nothing to check is given an empty expect
 * block: "it runs on this" is a check, and without one `check` reports the
 * section as unreadable and `test` and ✨ pass it over.
 *
 * An input emptied is the example taken away, not one run on nothing. It was
 * written as `{}`, which `test` then ran the node on and the box showed again
 * when the dialog was reopened, and there was no way left to remove an
 * example. An expectation or a judge written without an input stays, in a
 * section with no input block: `check` says what it lacks, `test` runs nothing
 * on it, and what was written in step 2 is still there once step 1 is filled.
 * (A node with no inputs is run on `{}`, and its caller writes that:
 * `nodeStepRules.exampleFor`.)
 *
 * A first section left holding no example is dropped -- unless another
 * section follows. That one would then be the first, and the next keystroke
 * of someone who emptied the box to type it afresh would land in an example
 * written by hand; the emptied one stays instead, for `check` to point at.
 */
function withBlock(text: string | undefined, role: Role, body: string): string {
  const { before, first, after } = cut(text ?? '');
  if (role === 'input' && !body.trim()) {
    if (!first) return text ?? '';
    const section = without(first, 'input');
    return holdsExample(section) || after ? assemble(before, section, after) : before;
  }
  if (!first) {
    const section = `## ${PAIR_TITLE}\n\n${block(role, body)}${role === 'input' ? `\n\n${block('expect', '{}')}` : ''}\n`;
    if (!holdsExample(section)) return text ?? '';
    const lead = before.trim() ? `${before.trimEnd()}\n\n` : '';
    return `${lead}${section}`;
  }
  const blocks = exampleBlocks(first);
  const own = blocks.find((candidate) => candidate.role === role);
  let section: string;
  if (own) {
    section = `${first.slice(0, own.start)}${block(role, body)}${first.slice(own.end)}`;
  } else if (role !== 'input') {
    // After the input -- a judge after the expectation too -- where a reader looks for it.
    const input = blocks.find((candidate) => candidate.role === 'input');
    const expect = role === 'judge' ? blocks.find((candidate) => candidate.role === 'expect') : undefined;
    const anchor = expect ?? input;
    const at = anchor ? anchor.end : first.trimEnd().length;
    section = `${first.slice(0, at)}\n\n${block(role, body)}${first.slice(at)}`;
  } else {
    // Under the title line.
    const at = first.indexOf('\n') < 0 ? first.length : first.indexOf('\n');
    section = `${first.slice(0, at)}\n\n${block('input', body)}${first.slice(at)}`;
  }
  const checked = exampleBlocks(section).some((candidate) => candidate.role === 'expect' || candidate.role === 'judge');
  if (role === 'input' && !checked) {
    const input = exampleBlocks(section).find((candidate) => candidate.role === 'input')!;
    section = `${section.slice(0, input.end)}\n\n${block('expect', '{}')}${section.slice(input.end)}`;
  }
  return holdsExample(section) || after ? assemble(before, section, after) : before;
}

/** *text* with the first pair's input set to *body*, the JSON as typed. */
export function withInput(text: string | undefined, body: string): string {
  return withBlock(text, 'input', body);
}

/** *text* with the first pair's expected output set to *body*; empty means "only that it runs". */
export function withExpect(text: string | undefined, body: string): string {
  return withBlock(text, 'expect', body);
}

/**
 * *text* with the first pair's judge set to *sentence*: what a model holds
 * the node's answer to when `test` runs the example -- the check for an answer
 * that is never the same twice. Empty takes it away.
 *
 * An expect block that names nothing makes way for a judge, and comes back
 * when the judge goes: the pair always checks something, and a judged example
 * is not run offline only to check that it runs.
 */
export function withJudge(text: string | undefined, sentence: string): string {
  if (sentence.trim()) {
    const { before, first, after } = cut(withBlock(text, 'judge', sentence));
    const empty = exampleBlocks(first).some(checksNothing);
    return assemble(before, empty ? without(first, 'expect') : first, after);
  }
  const { before, first, after } = cut(text ?? '');
  if (!exampleBlocks(first).some((candidate) => candidate.role === 'judge')) return text ?? '';
  const section = without(first, 'judge');
  const unchecked = !exampleBlocks(section).some((candidate) => candidate.role === 'expect');
  const judged = assemble(before, section, after);
  return unchecked ? withExpect(judged, '{}') : judged;
}

const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

/**
 * *text* with its examples keyed by the ports' names as they are now: for
 * each name in *names* (`portRenames.renamedPorts`), an input block's key --
 * and an expect block's, for an output -- renamed, or dropped where the port
 * is gone. Every section, not only the first: `test` and `check` read them
 * all, and hold each to the ports.
 *
 * A key is left where it is when the new name is a key of that block already:
 * a rename typed through another port's name ("text2" to "text3" passes
 * "text") must not overwrite that port's value on its way. A block that is not
 * an object yet is left as typed.
 */
export function examplesFollowPorts(
  text: string,
  names: { inputs: Record<string, string | null>; outputs: Record<string, string | null> },
): string {
  const normal = text.replace(/\r\n/g, '\n');
  const marker = normal.search(EXAMPLE_SECTION);
  if (marker < 0) return text;
  let out = normal;
  let changed = false;
  for (const own of exampleBlocks(normal).reverse()) {
    if (own.start < marker || (own.role !== 'input' && own.role !== 'expect')) continue;
    const fate = own.role === 'input' ? names.inputs : names.outputs;
    const value = exampleObject(own.body);
    if (!value) continue;
    const entries: [string, unknown][] = [];
    for (const [key, item] of Object.entries(value)) {
      const into = has(fate, key) ? fate[key] : key;
      if (into === null) continue;
      entries.push([has(value, into) ? key : into, item]);
    }
    if (JSON.stringify(entries.map(([key]) => key)) === JSON.stringify(Object.keys(value))) continue;
    const bodyAt = own.end - 3 - own.body.length;
    out = `${out.slice(0, bodyAt)}${asExampleText(Object.fromEntries(entries))}\n${out.slice(own.end - 3)}`;
    changed = true;
  }
  return changed ? out : text;
}

/** A value as the example holds it: JSON, two spaces, as it is read back. */
export function asExampleText(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '';
}
