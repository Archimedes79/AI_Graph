// Writing an element's body with a model.
//
// One entry point, for every element that generates anything: the element
// says what kind of body it wants (`Generation`), and this says how to ask for
// it. Four kinds — code, a system prompt, an output-format description, a data
// node's format contract — plus authoring a whole graph, which shares neither
// the request nor the answer and so stands apart.
//
// Code is not one call. It is generated, run once against real data when the
// caller has some, and repaired once with the evidence when that run fails —
// because a wrong output key is the single most common way generated code
// "works" and still delivers nothing, and all of it becomes knowable the
// moment the code executes. The second pass is not "try again"; it is "here
// is exactly what went wrong", which is why one extra round is usually
// enough and why there is no third.
//
// Every call a generation makes is recorded and handed back, so the editor can
// show what was sent when the answer is "the model returned nothing".

import { readFile } from 'node:fs/promises';
import type { AiRequest, AiService, CodeRunner } from '../../element.ts';
import type { Generation } from '../../generation.ts';
import { renderSkeleton } from './skeleton.ts';
import { GRAPH_SYSTEM } from './graphPrompt.ts';
import { detectFormat } from './files.ts';

// ---------------------------------------------------------------------------
// What comes in and what goes out -- the shapes the editor already reads
// ---------------------------------------------------------------------------

export interface GenerateRequest {
  /** A node type or block kind; the element's own `Generation` decides the rest. */
  element?: string;
  /** For the one generation that belongs to no element: an output-format description. */
  kind?: string;
  description: string;
  context?: string;
  /** A file whose content is appended to the context, read here. */
  context_file?: string;
  inputs?: string[];
  outputs?: string[];
  /** Real port values from the last run; enables the verify-and-repair pass. */
  sample_inputs?: Record<string, unknown> | null;
  input_sources?: Record<string, string>;
}

export interface AICall {
  provider: string;
  model: string;
  system: string;
  prompt: string;
  sent_chars: number;
  reply: string | null;
  reply_chars: number;
  seconds: number;
  error: string | null;
}

export interface ProbeReport {
  status: 'skipped' | 'ok' | 'repaired' | 'failed';
  attempts: number;
  error: string;
  missing_outputs: string[];
  output_preview: string;
  /** What the code actually returned, whole -- the next node's sample, not a preview of it. */
  outputs?: Record<string, unknown>;
}

export interface GenerateResponse {
  result: string;
  explanation: string;
  probe: ProbeReport;
  calls: AICall[];
}

export class GenerationRefused extends Error {}

/** The model to ask, already resolved. */
export interface Target { provider: string; model: string }

// ---------------------------------------------------------------------------
// The transcript
// ---------------------------------------------------------------------------

/** An AI service that writes down every call it makes, for one generation. */
export function recording(ai: AiService, calls: AICall[]): AiService {
  return {
    async complete(request: AiRequest): Promise<string> {
      const entry: AICall = {
        provider: request.provider ?? '',
        model: request.model ?? '',
        system: request.system ?? '',
        prompt: request.prompt,
        // Counted here rather than in the browser: "how much did I send" is
        // the question a context-window error raises.
        sent_chars: (request.system ?? '').length + request.prompt.length,
        reply: null, reply_chars: 0, seconds: 0, error: null,
      };
      calls.push(entry);
      const started = Date.now();
      try {
        const reply = await ai.complete(request);
        entry.reply = reply;
        entry.reply_chars = reply.length;
        return reply;
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        entry.seconds = Math.round((Date.now() - started) / 10) / 100;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** A structured peek at a sample file, so the model can reason about its shape. */
function parsedPreview(content: string, format: string): string {
  try {
    if (format === 'csv') {
      const [head, ...rows] = content.split(/\r?\n/).filter((line) => line.trim());
      if (!head) return '';
      const columns = head.split(',');
      const records = rows.slice(0, 8).map((row) => Object.fromEntries(row.split(',').map((cell, i) => [columns[i] ?? String(i), cell])));
      return JSON.stringify(records, null, 2);
    }
    if (format === 'json') {
      const parsed = JSON.parse(content);
      return JSON.stringify(Array.isArray(parsed) ? parsed.slice(0, 8) : parsed, null, 2);
    }
  } catch {
    return '';
  }
  return '';
}

/** *context* with a sample file's content, and a parsed peek at it, appended. */
export async function withContextFile(context: string, path?: string): Promise<string> {
  if (!path) return context;
  let content: string;
  let format: string;
  try {
    content = await readFile(path, 'utf8');
    format = await detectFormat(path);
  } catch (error) {
    throw new GenerationRefused(`Could not read context file: ${error instanceof Error ? error.message : String(error)}`);
  }
  let block = `Context file (${path}, format=${format}):\n${content}`;
  const preview = parsedPreview(content, format);
  if (preview) block += `\n\nParsed preview (up to 8 records/items):\n${preview}`;
  return context ? `${context}\n\n${block}` : block;
}

// ---------------------------------------------------------------------------
// The four bodies
// ---------------------------------------------------------------------------

const CODE_SYSTEM =
  'You are an expert software engineer. When asked to generate code, output ONLY valid code '
  + 'inside a markdown code block, followed by a brief explanation outside the block. Do not add '
  + 'extra prose before the code block. The returned object\'s keys must exactly match the '
  + 'requested output names - downstream nodes look up values by these exact keys.';

function firstCodeBlock(text: string): string {
  return /```(?:\w+)?\n([\s\S]*?)```/.exec(text)?.[1].trim() ?? '';
}

/** Ask for code that maps *inputs* to *outputs*, handed the skeleton to complete. */
async function generateCode(
  ai: AiService, target: Target, request: GenerateRequest, context: string,
): Promise<{ text: string; explanation: string }> {
  const inputs = request.inputs ?? [];
  const outputs = request.outputs ?? [];
  const parts = ['Write a JavaScript function that does the following:', request.description];
  if (context) parts.push(`\nContext:\n${context}`);
  if (inputs.length || outputs.length) {
    // The signature rather than a list of port names: the skeleton states the
    // types and the shapes, with the values the ports actually carried last
    // run when the caller supplied a sample.
    parts.push('\nComplete this function. Keep the signature and the returned keys exactly as they are:\n\n'
      + renderSkeleton(inputs, outputs, request.sample_inputs ?? undefined, request.input_sources));
  }
  if (outputs.length) {
    parts.push(`\nThe returned object's keys must be exactly: ${JSON.stringify(outputs)}. Downstream nodes look `
      + 'values up by these exact strings - do not rename, abbreviate, reorder, or invent additional keys, '
      + 'and include every one of them.');
  }
  parts.push('\nUse only what Node has built in. There is no package manager and no `npm install`: `require` '
    + "and `import` of anything outside Node's own standard library will fail at run time.");
  const raw = await ai.complete({ prompt: parts.join('\n'), system: CODE_SYSTEM, temperature: 0.2, ...target });
  const code = firstCodeBlock(raw);
  const explanation = code ? raw.slice(raw.lastIndexOf('```') + 3).trim() : raw.replace(/```(?:javascript|js)?/g, '').trim();
  return { text: code || raw, explanation };
}

/** One piece of text wrapped in `<tag>…</tag>`, and the explanation after it. */
async function generateTagged(
  ai: AiService, target: Target, system: string, tag: string, description: string, context: string, temperature = 0.3,
): Promise<{ text: string; explanation: string }> {
  let prompt = `Task description: ${description}`;
  if (context) prompt += `\n\nAdditional context: ${context}`;
  const raw = await ai.complete({ prompt, system, temperature, ...target });
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(raw);
  if (match) return { text: match[1].trim(), explanation: raw.slice(match.index + match[0].length).trim() };
  // A model that ignores the tags falls back to the whole reply, which beats nothing.
  return { text: raw.trim(), explanation: '' };
}

const PROMPT_SYSTEM =
  'You are an expert prompt engineer. Given a natural language description of a task, generate a '
  + 'concise, effective system prompt for an AI assistant. Output the system prompt as plain text '
  + 'inside <system_prompt> tags, then a brief explanation.';

const OUTPUT_FORMAT_SYSTEM =
  'You are an expert at specifying data output formats/shapes for software functions. Given a natural '
  + 'language description of a task, produce a concise, unambiguous description of the exact output '
  + 'format/shape the function should return (field names, types, nesting). This text is injected into '
  + 'other AI generation prompts verbatim -- it is descriptive, not executable code. Output the format '
  + 'description as plain text inside <output_format> tags, then a brief explanation.';

const DATA_FORMAT_SYSTEM =
  'You are an expert at designing the data format/schema a graph "data" node should persist. Given a task '
  + 'description and, if provided, example input data, propose two or three plausible candidate formats '
  + '(field names, types, nesting, or structure), briefly weigh their tradeoffs against the given examples, '
  + 'then commit to the single best one.\n\n'
  + 'Example:\n'
  + 'Task description: Store the extracted invoice line items.\n'
  + 'Example data: "3x Widget @ 9.99, 1x Gadget @ 19.99"\n'
  + 'Candidate formats:\n'
  + '1. A flat list of strings, one per line item.\n'
  + '2. A JSON array of {name, quantity, unit_price} objects.\n'
  + '3. A single JSON object keyed by item name mapping to quantity.\n'
  + 'Chosen format: option 2, because line items need distinct quantity and price fields for later '
  + 'calculations, and a list naturally accommodates any number of items.\n'
  + '<data_format>A JSON array of objects, each with "name" (string), "quantity" (integer), and '
  + '"unit_price" (number), e.g. [{"name": "Widget", "quantity": 3, "unit_price": 9.99}].</data_format>\n\n'
  + 'Now do the same for the given task: think through candidate proposals and your reasoning as plain '
  + 'text, then put only the final chosen format description (field names, types, nesting, and a '
  + 'representative example value) inside <data_format> tags, followed by a brief explanation.';

// ---------------------------------------------------------------------------
// Verify and repair
// ---------------------------------------------------------------------------

/** A probe is a smoke test, not a run: longer than this on one sample is not something a repair fixes. */
const PROBE_TIMEOUT_MS = 25_000;
const PREVIEW_LIMIT = 900;

/** A short, faithful rendering of a value for the model and the user. */
export function preview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}… (+${text.length - PREVIEW_LIMIT} characters)` : text;
}

function describeInputs(sample: Record<string, unknown>): string {
  return Object.entries(sample).map(([key, value]) => {
    let kind: string = Array.isArray(value) ? `list[${value.length}]` : value === null ? 'null' : typeof value;
    if (Array.isArray(value) && value.length) kind += ` of ${typeof value[0]}`;
    return `  inputs["${key}"]: ${kind} = ${preview(value)}`;
  }).join('\n');
}

async function probe(
  code: CodeRunner, body: string, sample: Record<string, unknown>,
): Promise<{ result: Record<string, unknown> | null; error: string }> {
  // Raced rather than killed: the runner owns its process. A body still busy
  // after the deadline is reported, and finishes on its own in the background.
  const deadline = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`The function did not finish within ${PROBE_TIMEOUT_MS / 1000}s on one sample item.`)), PROBE_TIMEOUT_MS).unref();
  });
  try {
    const result = await Promise.race([code.run(body, { ...sample }), deadline]);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return { result: null, error: `run() returned ${Array.isArray(result) ? 'an array' : typeof result}, but it must return an object.` };
    }
    return { result, error: '' };
  } catch (error) {
    return { result: null, error: (error instanceof Error ? error.message : String(error)).trim() };
  }
}

/** The evidence block handed to the second pass. */
function repairPrompt(body: string, sample: Record<string, unknown>, error: string, missing: string[], outputs: string[]): string {
  const parts = [
    'Your previous attempt was executed against real data and did not work. Fix it. Return the complete corrected function, not a patch.',
    '', '--- your previous attempt ---', body,
    '', '--- the inputs it actually received ---', describeInputs(sample) || '  (no inputs)',
  ];
  if (error) parts.push('', '--- the error it raised ---', error);
  if (missing.length) {
    parts.push('', '--- wrong result keys ---',
      `It ran, but the returned object is missing ${JSON.stringify(missing)}. The declared output ports are `
      + `${JSON.stringify(outputs)}; downstream nodes look values up by exactly these keys, so every one of them `
      + 'must be present in the returned object.');
  }
  return parts.join('\n');
}

/**
 * Generate code and, when a sample is available, verify it by running it.
 *
 * The code handed back is always the best one obtained: pass 2's if it improved
 * things, pass 1's otherwise -- a failed repair never leaves the user with
 * something worse than the first attempt.
 */
async function generateVerifiedCode(
  ai: AiService, code: CodeRunner, target: Target, request: GenerateRequest, context: string,
): Promise<{ text: string; explanation: string; probe: ProbeReport }> {
  const outputs = request.outputs ?? [];
  const sample = request.sample_inputs;
  const first = await generateCode(ai, target, request, context);
  const report: ProbeReport = { status: 'skipped', attempts: 0, error: '', missing_outputs: [], output_preview: '' };
  if (!sample || !Object.keys(sample).length) return { ...first, probe: report };

  report.attempts = 1;
  const attempt = await probe(code, first.text, sample);
  const missing = attempt.result ? outputs.filter((port) => !(port in attempt.result!)) : [];
  if (attempt.result && !missing.length) {
    return { ...first, probe: { ...report, status: 'ok', output_preview: preview(attempt.result), outputs: attempt.result } };
  }

  const evidence = [context, repairPrompt(first.text, sample, attempt.error, missing, outputs)].filter(Boolean).join('\n\n');
  let second: { text: string; explanation: string };
  try {
    second = await generateCode(ai, target, request, evidence);
  } catch {
    // The repair pass is a bonus, never a reason to fail the request.
    return { ...first, probe: { ...report, status: 'failed', error: attempt.error, missing_outputs: missing } };
  }
  report.attempts = 2;
  const again = await probe(code, second.text, sample);
  const stillMissing = again.result ? outputs.filter((port) => !(port in again.result!)) : [];
  if (again.result && !stillMissing.length) {
    return { ...second, probe: { ...report, status: 'repaired', output_preview: preview(again.result), outputs: again.result } };
  }
  // Still broken. Keep the attempt that got further -- running with wrong
  // keys beats not running at all -- and say what remains.
  if (attempt.result && !again.result) {
    return { ...first, probe: { ...report, status: 'failed', error: attempt.error, missing_outputs: missing } };
  }
  return { ...second, probe: { ...report, status: 'failed', error: again.error, missing_outputs: stillMissing } };
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

export interface GenerateDeps {
  ai: AiService;
  code: CodeRunner;
  /** The element's declaration, or undefined for a name that generates nothing. */
  generationFor: (element: string) => Generation | undefined;
  target: Target;
  /**
   * Where to write the transcript, if somebody is watching it.
   *
   * A generation is several calls -- write, probe, repair -- over a minute or
   * more, and until it returns there is nothing to see. Handing the array in
   * lets a caller read it while it fills, which is what the editor polls to
   * show the prompt, the context and each step as they happen.
   */
  calls?: AICall[];
}

/**
 * Generate one element's authored text, whatever the element is.
 *
 * The element's own contract goes first in the context: it says what the
 * running engine will do with this snippet, which nothing else can imply. A
 * sub-snippet whose ports the element fixes (a selector's `files`, a
 * transform's `value`) is generated against those and not probed against the
 * node's sample, which is keyed by ports it does not have.
 */
export async function generate(request: GenerateRequest, deps: GenerateDeps): Promise<GenerateResponse> {
  const calls: AICall[] = deps.calls ?? [];
  const ai = recording(deps.ai, calls);
  const spec = request.element ? deps.generationFor(request.element) : undefined;
  if (request.element && !spec) throw new GenerationRefused(`'${request.element}' is not an element that generates anything`);
  const kind = spec?.kind ?? request.kind ?? '';

  const context = await withContextFile(
    [spec?.contract ?? '', request.context ?? ''].filter(Boolean).join('\n\n'),
    request.context_file,
  );
  const fixedPorts = Boolean(spec?.inputs);
  const shaped: GenerateRequest = fixedPorts
    ? { ...request, inputs: spec!.inputs, outputs: spec!.outputs ?? request.outputs, sample_inputs: null, input_sources: undefined }
    : request;

  try {
    switch (kind) {
      case 'code': {
        const { text, explanation, probe: report } = await generateVerifiedCode(ai, deps.code, deps.target, shaped, context);
        return { result: text, explanation, probe: report, calls };
      }
      case 'prompt':
      case 'output_format':
      case 'data_format': {
        const system = kind === 'prompt' ? PROMPT_SYSTEM : kind === 'output_format' ? OUTPUT_FORMAT_SYSTEM : DATA_FORMAT_SYSTEM;
        const tag = kind === 'prompt' ? 'system_prompt' : kind;
        const { text, explanation } = await generateTagged(ai, deps.target, system, tag, request.description, context);
        return { result: text, explanation, probe: { status: 'skipped', attempts: 0, error: '', missing_outputs: [], output_preview: '' }, calls };
      }
      default:
        throw new GenerationRefused(`Unknown generation kind '${kind}'`);
    }
  } catch (error) {
    if (error instanceof GenerationRefused) throw error;
    // The failing generation is the one whose transcript is worth reading.
    throw new GenerationFailed(error instanceof Error ? error.message : String(error), calls);
  }
}

export class GenerationFailed extends Error {
  readonly calls: AICall[];
  constructor(message: string, calls: AICall[]) {
    super(message);
    this.calls = calls;
  }
}

// ---------------------------------------------------------------------------
// A whole graph
// ---------------------------------------------------------------------------

// The system prompt lives in graphPrompt.ts: it is prose, and it is long.

/** Ask for a whole Graph DSL document from a description. The caller parses it. */
export async function generateGraph(
  description: string, context: string, deps: Pick<GenerateDeps, 'ai' | 'target' | 'calls'>,
): Promise<{ graph: unknown; explanation: string; calls: AICall[] }> {
  const calls: AICall[] = deps.calls ?? [];
  const ai = recording(deps.ai, calls);
  const parts = ['Design a graph that does the following:', description];
  if (context) parts.push(`\nContext:\n${context}`);
  let raw: string;
  try {
    raw = await ai.complete({ prompt: parts.join('\n'), system: GRAPH_SYSTEM, temperature: 0.2, ...deps.target });
  } catch (error) {
    throw new GenerationFailed(error instanceof Error ? error.message : String(error), calls);
  }
  const fenced = /```json\n([\s\S]*?)```/.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw.trim();
  let graph: unknown;
  try {
    graph = JSON.parse(candidate);
  } catch {
    throw new GenerationFailed('Could not parse a Graph DSL JSON document from the AI response', calls);
  }
  return { graph, explanation: fenced ? raw.slice(fenced.index + fenced[0].length).trim() : '', calls };
}
