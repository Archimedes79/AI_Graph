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
import type { AiRequest, AiService, CodeService, FileService, Runtime } from '../../elements/Runtime.ts';
import { runBody } from '../../elements/body.ts';
import { PLAIN_ASK } from '../../elements/nodes/ai/ask.ts';
import type { Generation } from '../../authoring/generation.ts';
import { readPorts } from '../../execution/fileInputs.ts';
import { renderSkeleton } from './skeleton.ts';
import { BUDGET, clip, exampleSample, renderBrief, type Sample } from './brief.ts';
import { unmet } from '../../execution/examples.ts';
import { GRAPH_SYSTEM } from './graphPrompt.ts';
import { detectFormat } from './files.ts';
import type { AICall, GenerateRequest, GenerateResponse, ProbeReport, Target } from '../api.ts';

export class GenerationRefused extends Error {}

/** Thrown by the preview "model" at the first request: everything up to it was real. */
class PreviewReached extends Error {}

/** A model that never answers: the request is recorded and the generation stops there. */
const PREVIEW_AI: AiService = {
  async complete(): Promise<string> {
    throw new PreviewReached('preview');
  },
};

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
      const records = rows.slice(0, 5).map((row) => Object.fromEntries(row.split(',').map((cell, i) => [columns[i] ?? String(i), cell])));
      return JSON.stringify(records, null, 2);
    }
    if (format === 'json') {
      const parsed = JSON.parse(content);
      return JSON.stringify(Array.isArray(parsed) ? parsed.slice(0, 5) : parsed, null, 2);
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
  // Cut to a budget: a sample file is attached to show what arrives, and the
  // first rows of a 40 MB CSV show that as well as all of it -- which would
  // not fit in a local model's window at all.
  let block = `Sample file (${path}, format=${format}):\n${clip(content, BUDGET.file)}`;
  const preview = parsedPreview(content, format);
  if (preview) block += `\n\nParsed, the first records:\n${clip(preview, BUDGET.file / 2)}`;
  return context ? `${context}\n\n${block}` : block;
}

// ---------------------------------------------------------------------------
// The four bodies
// ---------------------------------------------------------------------------

const CODE_SYSTEM =
  'You are an expert software engineer. When asked to generate code, output ONLY valid code '
  + 'inside a markdown code block, followed by a brief explanation outside the block. Do not add '
  + 'extra prose before the code block. The returned object\'s keys must exactly match the '
  + 'requested output names - downstream nodes look up values by these exact keys. '
  // Every body may ask (`elements/body.ts`), and a generator that is not told so
  // writes a word list where a question was wanted -- or guesses at an API.
  + 'When the task needs the judgement of a model -- classifying, summarising, extracting meaning -- declare '
  + 'the function as "async function run(inputs, node)" and ask with '
  + '"await node.llm({ prompt: "..." })", which resolves to the answer as text; never call a model API '
  + 'yourself and never use a key. For everything else, plain code.';

function firstCodeBlock(text: string): string {
  return /```(?:\w+)?\n([\s\S]*?)```/.exec(text)?.[1].trim() ?? '';
}

/**
 * Ask for code that maps *inputs* to *outputs*: the task, the brief, whatever
 * else the element or the caller adds, then the skeleton to complete.
 * *evidence* is a failed attempt and what went wrong with it, for the repair.
 */
async function generateCode(
  ai: AiService, target: Target, request: GenerateRequest, context: string, sample?: Sample, evidence = '',
): Promise<{ text: string; explanation: string }> {
  const inputs = request.inputs ?? [];
  const outputs = request.outputs ?? [];
  const parts = ['Write a JavaScript function for one node of a graph. The node should:', request.description];
  const brief = renderBrief(request, 'code', sample);
  if (brief) parts.push(`\n${brief}`);
  if (context) parts.push(`\n## Also\n${context}`);
  if (evidence) parts.push(`\n${evidence}`);
  parts.push('\n## The function');
  if (inputs.length || outputs.length) {
    parts.push('Complete this function. Keep its name, its `inputs` and the returned keys exactly as they are:\n\n'
      + renderSkeleton(inputs, outputs, sample?.values, request.input_types));
  }
  if (outputs.length) {
    parts.push(`The returned object's keys must be exactly: ${JSON.stringify(outputs)}. Downstream nodes look `
      + 'values up by these exact strings - do not rename, abbreviate, reorder, or invent additional keys, '
      + 'and include every one of them.');
  }
  parts.push('Use only what Node has built in. There is no package manager and no `npm install`: `require` '
    + "and `import` of anything outside Node's own standard library will fail at run time.");
  const raw = await ai.complete({ prompt: parts.join('\n'), system: CODE_SYSTEM, temperature: 0.2, ...target });
  const code = firstCodeBlock(raw);
  const explanation = code ? raw.slice(raw.lastIndexOf('```') + 3).trim() : raw.replace(/```(?:javascript|js)?/g, '').trim();
  return { text: code || raw, explanation };
}

/** One piece of text wrapped in `<tag>…</tag>`, and the explanation after it. */
async function generateTagged(
  ai: AiService, target: Target, system: string, tag: string, prompt: string, temperature = 0.3,
): Promise<{ text: string; explanation: string }> {
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

/** A probe with no way to read files: what it asks a model cannot name one. */
const refuse = async (): Promise<never> => { throw new Error('No files here: this body is being tried on a sample.'); };
const NO_FILES: FileService = { resolve: (path) => path, exists: async () => false, read: refuse, write: refuse, list: refuse };

async function probe(
  runtime: Runtime, target: Target, body: string, sample: Record<string, unknown>,
): Promise<{ result: Record<string, unknown> | null; error: string }> {
  // Ended, not merely given up on: a generated body in an endless loop is a
  // process, and one per ✨ press left running is how a laptop gets warm.
  const stop = new AbortController();
  const clock = setTimeout(() => stop.abort(), PROBE_TIMEOUT_MS);
  clock.unref();
  try {
    // Run as a graph runs it (`elements/body.ts`): generated code that asks a
    // model through `node.llm` is tried with a `node` that can be asked.
    // What it asks is answered by the model that wrote it: there is no graph
    // here whose default could be meant, and that one is known to answer.
    const ask = { ...PLAIN_ASK, provider: target.provider, model: target.model };
    const result = await runBody(body, { ...sample }, runtime, { signal: stop.signal, ask });
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return { result: null, error: `run() returned ${Array.isArray(result) ? 'an array' : typeof result}, but it must return an object.` };
    }
    return { result, error: '' };
  } catch (error) {
    if (stop.signal.aborted) {
      return { result: null, error: `The function did not finish within ${PROBE_TIMEOUT_MS / 1000}s on one sample item.` };
    }
    return { result: null, error: (error instanceof Error ? error.message : String(error)).trim() };
  } finally {
    clearTimeout(clock);
  }
}

/** The evidence block handed to the second pass. */
function repairPrompt(body: string, sample: Record<string, unknown>, error: string, missing: string[], outputs: string[], problems: string[] = []): string {
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
  if (problems.length) {
    parts.push('', '--- what is wrong with what it produced ---',
      'It ran and returned the right keys, but the result itself was checked and is not usable as it stands:',
      ...problems.map((problem) => `- ${problem}`));
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
  ai: AiService, runtime: Runtime, target: Target, request: GenerateRequest, context: string,
  given: Sample | undefined,
  check?: (outputs: Record<string, unknown>) => string[],
  probeWith?: (body: string) => string,
): Promise<{ text: string; explanation: string; probe: ProbeReport }> {
  const outputs = request.outputs ?? [];
  const sample = given?.values;
  const first = await generateCode(ai, target, request, context, given);
  const report: ProbeReport = { status: 'skipped', attempts: 0, error: '', missing_outputs: [], output_preview: '' };
  if (!sample || !Object.keys(sample).length) return { ...first, probe: report };
  // A sample that is an example says what must come out of it, and that is
  // checked too -- an example is a test, and a body that returns the right
  // keys with the wrong contents has not passed it. Only when nothing in it
  // is a list: a node run once per item returns one item's result, not the
  // list the example expects of the whole node.
  const expect = given?.expect && !Object.values(sample).some(Array.isArray) ? given.expect : undefined;

  /**
   * Run it, then ask three questions in order: did it run, did it return the
   * right keys, and -- the element's own question -- is what it returned any
   * good. A chart that runs and returns `value` can still be a drawing with
   * NaN for every coordinate; only the element that draws it knows to look.
   */
  const judge = async (body: string) => {
    // Some bodies are not run the way the sandbox runs one -- a chart's is
    // run by the page. The element says how to make it runnable; everyone
    // else is run as written.
    const ran = await probe(runtime, target, probeWith ? probeWith(body) : body, sample);
    const missing = ran.result ? outputs.filter((port) => !(port in ran.result!)) : [];
    const problems = ran.result && !missing.length
      ? [...(check ? check(ran.result) : []), ...(expect ? unmet(expect, ran.result).map((gap) => `for ${given!.origin}, ${gap}`) : [])]
      : [];
    // How far it got: not at all, wrong keys, a flawed result, a good one.
    const reached = !ran.result ? 0 : missing.length ? 1 : problems.length ? 2 : 3;
    return { ...ran, missing, problems, reached };
  };
  const reportOf = (verdict: Awaited<ReturnType<typeof judge>>, status: ProbeReport['status']): ProbeReport => ({
    ...report, status, error: verdict.error, missing_outputs: verdict.missing, problems: verdict.problems,
    ...(verdict.result ? { output_preview: preview(verdict.result), outputs: verdict.result } : {}),
  });

  report.attempts = 1;
  const attempt = await judge(first.text);
  if (attempt.reached === 3) return { ...first, probe: reportOf(attempt, 'ok') };

  const evidence = repairPrompt(first.text, sample, attempt.error, attempt.missing, outputs, attempt.problems);
  let second: { text: string; explanation: string };
  try {
    second = await generateCode(ai, target, request, context, given, evidence);
  } catch {
    // The repair pass is a bonus, never a reason to fail the request.
    return { ...first, probe: reportOf(attempt, 'failed') };
  }
  report.attempts = 2;
  const again = await judge(second.text);
  if (again.reached === 3) return { ...second, probe: reportOf(again, 'repaired') };
  // Still not right. Keep the attempt that got further -- a chart with one
  // label off the edge beats one that does not run -- and say what remains.
  return again.reached >= attempt.reached
    ? { ...second, probe: reportOf(again, 'failed') }
    : { ...first, probe: reportOf(attempt, 'failed') };
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

export interface GenerateDeps {
  ai: AiService;
  code: CodeService;
  /** Reads the files a sample names, for a node that is handed their text. Without it the sample stays as sent. */
  files?: FileService;
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
 * transform's `value`) is generated against those -- and probed against a
 * sample only when the sample is keyed by those same ports. The node's own
 * sample is keyed by ports the snippet does not have; the block editor sends
 * one shaped as the snippet sees it (`{value: …}`), and that one is used.
 */
/**
 * The request with its sample as the body will meet it.
 *
 * A sample is what came off the wires, and for a node that reads its file
 * inputs that is a path where the body gets the text. Shown as it was, the
 * model is told `csv` is "D:\data\sales.csv" and the code is then tried on
 * that string: it finds no rows, returns an empty chart, and the probe calls
 * that a pass. So the files are read here, by the function a run reads them
 * with. One that cannot be read turns the verify pass off rather than letting
 * it vouch for code it tried on a filename.
 */
async function asReceived(request: GenerateRequest, files?: FileService): Promise<GenerateRequest> {
  const sample = request.sample_inputs;
  const ports = (request.read_file_ports ?? []).filter((port) => sample && sample[port] !== null && sample[port] !== undefined);
  if (!sample || !ports.length || !files) return request;
  const sources = { ...request.input_sources };
  for (const port of ports) sources[port] = [sources[port], 'the text of the file, already read'].filter(Boolean).join(': ');
  try {
    return { ...request, sample_inputs: await readPorts(sample, ports, files), input_sources: sources };
  } catch {
    return { ...request, sample_inputs: null, input_sources: sources };
  }
}

export async function generate(asked: GenerateRequest, deps: GenerateDeps): Promise<GenerateResponse> {
  // Real data when the graph has run; the first example's inputs when it has
  // not -- an example is the person saying what arrives. Either is read as a
  // run would read it (`asReceived`), shown in the brief and tried the code on.
  const ran = asked.sample_inputs && Object.keys(asked.sample_inputs).length;
  const exampled = ran ? undefined : exampleSample(asked.examples);
  const request = await asReceived(exampled ? { ...asked, sample_inputs: exampled.values } : asked, deps.files);
  const calls: AICall[] = deps.calls ?? [];
  // A preview runs every step a generation does up to the model, and stops
  // there: the request it hands back is the request, not a second rendering
  // of it that could differ.
  const ai = recording(request.preview ? PREVIEW_AI : deps.ai, calls);
  const spec = request.element ? deps.generationFor(request.element) : undefined;
  if (request.element && !spec) throw new GenerationRefused(`'${request.element}' is not an element that generates anything`);
  const kind = spec?.kind ?? request.kind ?? '';

  const context = await withContextFile(
    [spec?.contract ?? '', request.context ?? ''].filter(Boolean).join('\n\n'),
    request.context_file,
  );
  const fixedPorts = Boolean(spec?.inputs);
  const fits = fixedPorts && request.sample_inputs
    && Object.keys(request.sample_inputs).every((key) => spec!.inputs!.includes(key));
  const shaped: GenerateRequest = fixedPorts
    ? {
      ...request, inputs: spec!.inputs, outputs: spec!.outputs ?? request.outputs,
      sample_inputs: fits ? request.sample_inputs : null, input_sources: undefined,
    }
    : request;

  const values = shaped.sample_inputs;
  const sample: Sample | undefined = values && Object.keys(values).length
    ? { values, origin: exampled?.origin ?? request.sample_origin ?? 'the last run', expect: exampled?.expect }
    : undefined;

  try {
    switch (kind) {
      case 'code': {
        const { text, explanation, probe: report } = await generateVerifiedCode(ai, { code: deps.code, ai, files: deps.files ?? NO_FILES }, deps.target, shaped, context, sample, spec?.check, spec?.probeWith);
        return { result: text, explanation, probe: report, calls };
      }
      case 'prompt': {
        // The same brief a code node's body is written from: a system prompt
        // is written for a model that is sent these inputs, and whose answer
        // goes where the outputs go.
        const prompt = [
          `Task: ${request.description}`,
          renderBrief(request, 'prompt', sample),
          context ? `## Also\n${context}` : '',
          'Write the system prompt for the model this node calls. It is sent what is described above, '
          + 'every time the node runs, and its answer goes where the outputs go.',
        ].filter(Boolean).join('\n\n');
        const { text, explanation } = await generateTagged(ai, deps.target, PROMPT_SYSTEM, 'system_prompt', prompt);
        return { result: text, explanation, probe: { status: 'skipped', attempts: 0, error: '', missing_outputs: [], output_preview: '' }, calls };
      }
      case 'output_format':
      case 'data_format': {
        const system = kind === 'output_format' ? OUTPUT_FORMAT_SYSTEM : DATA_FORMAT_SYSTEM;
        const prompt = `Task description: ${request.description}${context ? `\n\nAdditional context: ${context}` : ''}`;
        const { text, explanation } = await generateTagged(ai, deps.target, system, kind, prompt);
        return { result: text, explanation, probe: { status: 'skipped', attempts: 0, error: '', missing_outputs: [], output_preview: '' }, calls };
      }
      default:
        throw new GenerationRefused(`Unknown generation kind '${kind}'`);
    }
  } catch (error) {
    if (error instanceof PreviewReached) {
      // Recorded as a failure by `recording`; it is not one.
      const last = calls.at(-1);
      if (last) last.error = null;
      return { result: '', explanation: '', probe: { status: 'skipped', attempts: 0, error: '', missing_outputs: [], output_preview: '' }, calls, preview: true };
    }
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
