// What ✨ Generate is told about a node: one brief, the same for code and for a
// system prompt.
//
// A body is written against four things, and a node already holds all four:
//
//     the task        what it should do, in the person's words
//     what comes in   each input -- its type, what it holds, where it is wired
//                     from and what that node hands on -- and one real sample
//     what goes out   each output, where it goes and what the node there
//                     wants; the format in words; an example; the kept shape
//     examples        inputs, and what must come out
//
// They used to reach the model from five places in five wordings, some of
// them twice (a neighbour line *and* a skeleton comment for the same wire),
// some not at all (the format description unless "custom" was picked, the
// examples, the example inputs), and a sample file in full, however large.
// Here each is said once, in a fixed order, and everything that can be long is
// cut to a budget: the brief has to leave a small local model room to answer.

import { parseExamples } from '../../execution/examples.ts';
import { schemaOutline as outline } from '../../execution/interface.ts';
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
  outputExample: 900,
  schema: 700,
  template: 800,
  /** An attached sample file. */
  file: 2000,
} as const;

/** *text*, cut to *limit* characters, saying how much was left out. */
export function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}… (${trimmed.length - limit} more characters not shown)`;
}

/** A value as the model should read it: JSON, so a string's line breaks and a list's length are visible. */
export function shown(value: unknown, limit: number): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  const count = Array.isArray(value) ? `a list of ${value.length}: ` : '';
  return count + clip(text, limit);
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

function inputsSection(request: GenerateRequest, kind: 'code' | 'prompt', sample?: Sample): string {
  const inputs = request.inputs ?? [];
  const lines = [kind === 'code' ? '## What comes in' : '## What the model is sent'];
  if (!inputs.length) {
    lines.push('Nothing is wired in.');
    return lines.join('\n');
  }
  let room: number = BUDGET.samples;
  for (const port of inputs) {
    const type = typeWords(request.input_types?.[port]);
    const said = oneLine(request.input_notes?.[port]);
    lines.push(`- \`${port}\`${type ? ` (${type})` : ''}${said ? `: ${said}` : ''}`);
    const source = request.input_sources?.[port];
    // A snippet whose ports the element fixes (a chart's `value`) is told no
    // wiring at all, rather than told it is unwired.
    if (source) lines.push(`  from ${source}`);
    else if (request.input_sources) lines.push('  not wired yet');
    if (sample && port in sample.values) {
      if (room <= 0) {
        lines.push('  sample: left out, the ones above fill the space');
      } else {
        const peek = shown(sample.values[port], Math.min(BUDGET.sample, room));
        room -= peek.length;
        lines.push(`  sample, from ${sample.origin}: ${peek}`);
      }
    }
  }
  if (kind === 'code' && request.batch_mode) {
    lines.push(request.batch_mode === 'whole_list'
      ? 'A list arrives whole: `run` is called once with the full lists and must handle or reduce them.'
      : 'A list arrives one item at a time: `run` is called once per item, with one value from each list input.');
  }
  if (kind === 'prompt') {
    const template = request.message_template?.trim();
    lines.push(template
      ? `They are laid out in the message like this, {{name}} standing for that input's value:\n${clip(template, BUDGET.template)}`
      : 'They are sent one after another as they arrive, with nothing around them.');
  }
  return lines.join('\n');
}

function outputsSection(request: GenerateRequest, kind: 'code' | 'prompt'): string {
  const outputs = (request.outputs ?? []).filter((port) => port !== 'error');
  const lines = [kind === 'code' ? '## What goes out' : '## What the answer is for'];
  for (const port of outputs) {
    const said = oneLine(request.output_notes?.[port]);
    lines.push(`- \`${port}\`${said ? `: ${said}` : ''}`);
    const target = request.output_targets?.[port];
    if (target) lines.push(`  to ${target}`);
  }
  const format = request.output_format?.trim();
  if (format) lines.push(`Format: ${clip(format, BUDGET.format)}`);
  const example = request.output_example?.trim();
  if (example) lines.push(`An example of ${kind === 'code' ? 'what it returns' : 'an answer'} -- the same structure, new content:\n${clip(example, BUDGET.outputExample)}`);
  const schema = request.output_schema;
  if (schema && typeof schema === 'object') {
    lines.push(`The shape it returned so far, which the nodes after it were built against -- keep it: ${clip(outline(schema), BUDGET.schema)}`);
  }
  if (kind === 'prompt' && (format || example)) {
    lines.push('The format is added after the system prompt by itself, at run time: the system prompt need not repeat it, and must not contradict it.');
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function examplesSection(text: string | undefined): string {
  if (!text?.trim()) return '';
  const { examples } = parseExamples(text);
  if (!examples.length) return '';
  const lines = ['## Examples -- the result is checked against these'];
  for (const example of examples.slice(0, BUDGET.examples)) {
    lines.push(`- ${example.title}`, `  in: ${shown(example.inputs, BUDGET.example)}`);
    if (example.expect) lines.push(`  must return, at least: ${shown(example.expect, BUDGET.example)}`);
    if (example.judge) lines.push(`  the answer must: ${clip(example.judge, BUDGET.example)}`);
  }
  if (examples.length > BUDGET.examples) lines.push(`(and ${examples.length - BUDGET.examples} more, not shown)`);
  return lines.join('\n');
}

/**
 * Everything the node says about itself, in the order a body is written from
 * it. The task goes first and the element's fixed text last, by the caller.
 */
export function renderBrief(request: GenerateRequest, kind: 'code' | 'prompt', sample?: Sample): string {
  return [inputsSection(request, kind, sample), outputsSection(request, kind), examplesSection(request.examples)]
    .filter(Boolean).join('\n\n');
}
