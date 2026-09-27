// A node's one example: what goes in, and what should come out.
//
// It is kept where a node's examples always were, in `examples.md`
// (`config.examples`), as its first `## ` section -- an input block keyed by
// input port, and an expect block. `test` runs it, `check` holds it to the
// wiring, and ✨ Generate is written and tried against it (the engine reads it
// there, `brief.ts#exampleSample`). There is no second store: the dialog's
// step 1 and step 2 are views of this section and nothing else.
//
// A file may hold more than one section, written by hand or by an older
// version of the dialog. Only the first is edited here; the rest are kept as
// they are, and `test` still runs them.

/** How the engine tells the blocks of a section apart: see `execution/examples.ts`. */
const BLOCK = /```([^\n`]*)\n([\s\S]*?)```/g;
const SECTION = /^## +/m;

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

interface Block { role: 'input' | 'expect' | 'judge' | ''; start: number; end: number; body: string }

/** The file cut into what comes before the first section, the first section, and the rest. */
function cut(text: string): { before: string; first: string; after: string; others: number } {
  const normal = text.replace(/\r\n/g, '\n');
  const start = normal.search(SECTION);
  if (start < 0) return { before: normal, first: '', after: '', others: 0 };
  const rest = normal.slice(start + 3);
  const next = rest.search(SECTION);
  const first = next < 0 ? normal.slice(start) : normal.slice(start, start + 3 + next);
  const after = next < 0 ? '' : rest.slice(next);
  return { before: normal.slice(0, start), first, after, others: after ? after.split(SECTION).length - 1 : 0 };
}

function blocksOf(section: string): Block[] {
  return [...section.matchAll(BLOCK)].map((match) => {
    const words = match[1].trim().toLowerCase().split(/\s+/);
    const role = words.includes('input') ? 'input' : words.includes('expect') ? 'expect' : words.includes('judge') ? 'judge' : '';
    return { role, start: match.index!, end: match.index! + match[0].length, body: match[2] };
  });
}

/** An object keyed by port, or undefined: what `parseExamples` accepts as a block. */
function asObject(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** The first pair of *text*, as the dialog shows it. */
export function readPair(text: string | undefined): ExamplePair {
  const { first, others } = cut(text ?? '');
  const blocks = blocksOf(first);
  const input = blocks.find((block) => block.role === 'input');
  const expect = blocks.find((block) => block.role === 'expect');
  const judge = blocks.find((block) => block.role === 'judge');
  const pair: ExamplePair = {
    inputText: input?.body.trimEnd() ?? '',
    input: input ? asObject(input.body) : undefined,
    expectText: expect?.body.trimEnd() ?? '',
    expect: expect ? asObject(expect.body) : undefined,
    judge: judge?.body.trim() || undefined,
    title: first ? first.slice(3).split('\n', 1)[0].trim() : '',
    others,
    complete: false,
  };
  pair.complete = !!pair.input && (!!pair.expect || !!pair.judge);
  return pair;
}

function block(role: 'input' | 'expect', body: string): string {
  return `\`\`\`json ${role}\n${body.trim() || '{}'}\n\`\`\``;
}

/**
 * *text* with its first pair's *role* block set to *body*: replaced where it
 * is, added where it belongs when it is not there, and a first section begun
 * when the file has none. Everything else in the file stays as it was.
 *
 * A pair that gets an input and has nothing to check is given an empty expect
 * block: "it runs on this" is a check, and without one `check` reports the
 * section as unreadable and `test` and ✨ pass it over.
 */
function withBlock(text: string | undefined, role: 'input' | 'expect', body: string): string {
  const { before, first, after } = cut(text ?? '');
  if (!first) {
    const lead = before.trim() ? `${before.trimEnd()}\n\n` : '';
    const input = role === 'input' ? body : '{}';
    const expect = role === 'expect' ? body : '{}';
    return `${lead}## ${PAIR_TITLE}\n\n${block('input', input)}\n\n${block('expect', expect)}\n`;
  }
  const blocks = blocksOf(first);
  const own = blocks.find((candidate) => candidate.role === role);
  let section: string;
  if (own) {
    section = `${first.slice(0, own.start)}${block(role, body)}${first.slice(own.end)}`;
  } else if (role === 'expect') {
    // After the input, where a reader looks for it.
    const input = blocks.find((candidate) => candidate.role === 'input');
    const at = input ? input.end : first.trimEnd().length;
    section = `${first.slice(0, at)}\n\n${block('expect', body)}${first.slice(at)}`;
  } else {
    // Under the title line.
    const at = first.indexOf('\n') < 0 ? first.length : first.indexOf('\n');
    section = `${first.slice(0, at)}\n\n${block('input', body)}${first.slice(at)}`;
  }
  const checked = blocksOf(section).some((candidate) => candidate.role === 'expect' || candidate.role === 'judge');
  if (role === 'input' && !checked) {
    const input = blocksOf(section).find((candidate) => candidate.role === 'input')!;
    section = `${section.slice(0, input.end)}\n\n${block('expect', '{}')}${section.slice(input.end)}`;
  }
  if (!section.endsWith('\n')) section += '\n';
  return `${before}${section}${after && !section.endsWith('\n\n') ? '\n' : ''}${after}`;
}

/** *text* with the first pair's input set to *body*, the JSON as typed. */
export function withInput(text: string | undefined, body: string): string {
  return withBlock(text, 'input', body);
}

/** *text* with the first pair's expected output set to *body*; empty means "only that it runs". */
export function withExpect(text: string | undefined, body: string): string {
  return withBlock(text, 'expect', body);
}

/** A value as the example holds it: JSON, two spaces, as it is read back. */
export function asExampleText(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '';
}
