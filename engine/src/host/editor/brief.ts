// What ✨ Generate is told about a node: the three variables of its
// `prompt.md`, the same for code and for a model's instructions.
//
// A body is written against what a node already holds, and the node's
// `prompt.md` says where each part goes (`authoring/promptFile.ts`):
//
//     {Input Needs}      each input -- its type, what it holds, where it is
//                        wired from and what that node hands on, whether its
//                        file is read -- and one real sample
//     {Output Example}   each output, where it goes and what the node there
//                        wants; the output definition in words; the kept
//                        shape; and the examples, what must come out
//     {Graph}            the graph around the node, in words
//
// The request itself is the person's, after `Prompt:`.
//
// These used to reach the model from five places in five wordings, some of
// them twice (a neighbour line *and* a skeleton comment for the same wire),
// some not at all (the format description unless "custom" was picked, the
// examples, the example inputs), and a sample file in full, however large.
// Here each is said once, in a fixed order, and everything that can be long is
// cut to a budget: the prompt has to leave a small local model room to answer.

import { parseExamples } from '../../execution/examples.ts';
import { schemaOutline as outline } from '../../execution/interface.ts';
import type { PromptVariable } from '../../authoring/promptFile.ts';
import type { GenerateRequest } from '../api.ts';

/** How much of each part is shown, in characters. Together about 8 000 at most. */
export const BUDGET = {
  /** One input's sample: enough for its shape and a few rows. */
  sample: 700,
  /** Every sample together. */
  samples: 2400,
  /** How many examples: enough to show the pattern, not a test suite. */
  examples: 3,
  /** One example's inputs, or what it expects. */
  example: 400,
  format: 1200,
  /** A value a probe was given, in a repair prompt. */
  preview: 900,
  schema: 700,
  template: 800,
  /** The graph around the node. */
  graph: 2000,
} as const;

/** *text*, cut to *limit* characters, saying how much was left out. */
export function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}… (${trimmed.length - limit} more characters not shown)`;
}

/** A value as JSON, cut to *limit* characters: a string's line breaks stay visible. Anything JSON cannot say, as text. */
function jsonClip(value: unknown, limit: number): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return clip(text, limit);
}

/** A value as the model should read it: JSON, so a string's line breaks and a list's length are visible. */
export function shown(value: unknown, limit: number): string {
  const count = Array.isArray(value) ? `a list of ${value.length}: ` : '';
  return count + jsonClip(value, limit);
}

/** One line of a person's description: newlines would break the list it sits in. */
function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** A declared port type in words: `list of text` → `a list of text`. */
function typeWords(declared: string | undefined): string {
  if (!declared || declared === 'any') return '';
  return declared.startsWith('list of ') ? `a ${declared}` : declared;
}

/** Where a sample came from, for the model: real data and an example are not the same kind of evidence. */
export interface Sample {
  values: Record<string, unknown>;
  /** `the last run`, `the example "Two rows"`. */
  origin: string;
  /** What must come out for these inputs, when the sample is an example that says. */
  expect?: Record<string, unknown>;
  /**
   * For a node run once per item: how many items the sample had, of which
   * `values` is the first -- what one call is handed. A run makes this many.
   */
  items?: number;
}

/**
 * The inputs to fall back on when the graph has not run: the first example's.
 * An example is written by the person to show what arrives, which is exactly
 * what a sample is for -- and it was used only to check a body afterwards.
 */
export function exampleSample(examples: string | undefined): Sample | undefined {
  if (!examples?.trim()) return undefined;
  const first = parseExamples(examples).examples.find((example) => Object.keys(example.inputs ?? {}).length);
  return first ? { values: first.inputs, origin: `the example "${first.title}"`, expect: first.expect } : undefined;
}

/** What the brief is for: a body that runs (`code`), or a system prompt a model is sent (`prompt`). */
export type BriefKind = 'code' | 'prompt';

/**
 * What `{Input Needs}` says: each input -- its type, what it holds, whether
 * its file is read, where it is wired from and what that node hands on -- and
 * the sample, when there is one.
 */
export function inputNeeds(request: GenerateRequest, kind: BriefKind, sample?: Sample): string {
  const inputs = request.inputs ?? [];
  if (!inputs.length) return 'Nothing is wired in.';
  const lines: string[] = [];
  const reads = new Set(request.read_file_ports ?? []);
  let room: number = BUDGET.samples;
  const origin = !sample?.items ? sample?.origin
    : sample.items === 1 ? `${sample.origin}, its one item` : `${sample.origin}, the first of its ${sample.items} items`;
  for (const port of inputs) {
    const type = typeWords(request.input_types?.[port]);
    const said = oneLine(request.input_notes?.[port]);
    lines.push(`- \`${port}\`${type ? ` (${type})` : ''}${said ? `: ${said}` : ''}`);
    if (reads.has(port)) lines.push('  a path: the node reads the file there, and is handed its text');
    const source = request.input_sources?.[port];
    // A request that says nothing of the wiring -- one the editor did not
    // make -- is told none, rather than that every input is unwired.
    if (source) lines.push(`  from ${source}`);
    else if (request.input_sources) lines.push('  not wired yet');
    if (sample && port in sample.values) {
      if (room <= 0) {
        lines.push('  sample: left out, the ones above fill the space');
      } else {
        const peek = shown(sample.values[port], Math.min(BUDGET.sample, room));
        room -= peek.length;
        lines.push(`  sample, from ${origin}: ${peek}`);
      }
    }
  }
  // Said for a model's prompt as much as for code: a system prompt that says
  // "summarise each of the stories" to a model sent one story is wrong the
  // same way a `run` written for the list is. And said of what goes out: the
  // shape a run kept and an example's expectation are of the list the calls'
  // answers are collected into, and a body told it "must return" a list of
  // two was written for the list.
  if (request.batch_mode) {
    const perItem = request.batch_mode !== 'whole_list';
    lines.push(kind !== 'prompt'
      ? (perItem
        ? 'A list arrives one item at a time: `run` is called once per item, with one value from each list input. '
          + 'What the calls return is collected into one list per output: a shape or an example below describes '
          + 'that list, not what one call returns.'
        : 'A list arrives whole: `run` is called once with the full lists and must handle or reduce them.')
      : (perItem
        ? 'A list arrives one item at a time: the model is called once per item and is sent that one item, '
          + 'never the whole list; its answers are collected into a list.'
        : 'A list arrives whole: the model is sent the full list in one call.'));
  }
  if (kind === 'prompt') {
    const template = request.message_template?.trim();
    lines.push(template
      ? `They are laid out in the message like this now, {{name}} standing for that input's value:\n${clip(template, BUDGET.template)}`
      : 'They are sent one after another as they arrive, with nothing around them.');
  }
  return lines.join('\n');
}

/**
 * The node's examples. For a change (*changing*) they were written before it,
 * and a change is not held to them (`generate.ts`): said as the check, they
 * asked for the body the change replaces.
 */
function examplesPart(text: string | undefined, changing: boolean): string {
  if (!text?.trim()) return '';
  const { examples } = parseExamples(text);
  if (!examples.length) return '';
  const lines = [changing
    ? 'Examples -- written before this change: where one disagrees with the change, the change wins:'
    : 'Examples -- the result is checked against these:'];
  for (const example of examples.slice(0, BUDGET.examples)) {
    lines.push(`- ${example.title}`, `  in: ${shown(example.inputs, BUDGET.example)}`);
    if (example.expect) lines.push(`  must return, at least: ${shown(example.expect, BUDGET.example)}`);
    if (example.judge) lines.push(`  the answer must: ${clip(example.judge, BUDGET.example)}`);
  }
  if (examples.length > BUDGET.examples) lines.push(`(and ${examples.length - BUDGET.examples} more, not shown)`);
  return lines.join('\n');
}

/**
 * What `{Output Example}` says: each output, where it goes and what the node
 * there wants; the output definition, in the node's words; the shape a run
 * kept; and the examples, what must come out.
 */
export function outputExample(request: GenerateRequest): string {
  const lines: string[] = [];
  // Without the executor's error port: `generate` drops it where a request comes in.
  for (const port of request.outputs ?? []) {
    const said = oneLine(request.output_notes?.[port]);
    lines.push(`- \`${port}\`${said ? `: ${said}` : ''}`);
    const target = request.output_targets?.[port];
    if (target) lines.push(`  to ${target}`);
  }
  const format = request.output_format?.trim();
  if (format) lines.push(`Its output definition (output.md):\n${clip(format, BUDGET.format)}`);
  const schema = request.output_schema;
  if (schema && typeof schema === 'object') {
    lines.push(`The shape it returned so far, which the nodes after it were built against -- keep it: ${clip(outline(schema), BUDGET.schema)}`);
  }
  const examples = examplesPart(request.examples, !!request.refine?.change?.trim());
  if (examples) lines.push(examples);
  return lines.length ? lines.join('\n') : 'Nothing is said about it yet.';
}

/**
 * What the three variables of a node's `prompt.md` say, filled from the
 * request: the inputs with *sample* where there is one, the outputs and the
 * examples, and the graph around the node.
 */
export function promptVariables(request: GenerateRequest, kind: BriefKind, sample?: Sample): Record<PromptVariable, string> {
  return {
    'Input Needs': inputNeeds(request, kind, sample),
    'Output Example': outputExample(request),
    Graph: request.graph_context?.trim() ? clip(request.graph_context, BUDGET.graph) : 'Not given.',
  };
}
