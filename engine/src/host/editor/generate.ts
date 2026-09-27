// Writing an element's body with a model.
//
// One entry point, for every element that generates anything: the element
// says what kind of body it wants (`Generation`), and this says how to ask for
// it. Two kinds — code and a system prompt — plus authoring a whole graph,
// which shares neither the request nor the answer and so stands apart.
//
// What is sent is the node's `prompt.md` -- its template, its three variables
// filled from what the node holds (`brief.ts`), and the person's request --
// and after it the frame this file owns: what makes an answer usable, the
// skeleton to complete and the keys to return, not what the person asks.
//
// Besides a body, the same prompt writes the node's other two things
// (`write`): one example of what arrives at it, with the files the example
// reads, and its output definition. Neither is run.
//
// A body can also be changed rather than written anew (`refine`): "Say what to
// change" in a node's dialog sends the body there is, what came of it and what
// to change, and gets the body back with the request restated to fit it; ✨ Fix
// sends how it failed, and gets the repair a generation makes of its own first
// attempt. Same prompt, same verify-and-repair: not a second generator.
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

import type { AiRequest, AiService, CodeService, FileService, Runtime } from '../../elements/Runtime.ts';
import { runBody } from '../../elements/body.ts';
import { port } from '../../elements/port.ts';
import { PLAIN_ASK } from '../../elements/nodes/ai/ask.ts';
import type { Generation } from '../../authoring/generation.ts';
import { fillPrompt, requestOf, withRequest } from '../../authoring/promptFile.ts';
import { batchItems, mergeBatchOutputs } from '../../execution/batching.ts';
import { readPorts } from '../../execution/fileInputs.ts';
import { EXAMPLE_DIR, EXAMPLE_FILE_LIMIT, exampleFilesOf, withExampleFiles } from '../../execution/exampleFiles.ts';
import type { GraphNode } from '../../graph.ts';
import { renderSkeleton } from './skeleton.ts';
import { BUDGET, clip, exampleSample, promptVariables, shown, type BriefKind, type Sample } from './brief.ts';
import { unmet } from '../../execution/examples.ts';
import { ERROR_PORT } from '../../execution/wiring.ts';
import { GRAPH_SYSTEM } from './graphPrompt.ts';
import type { AICall, GenerateRequest, GenerateResponse, ProbeReport, Refine, Target } from '../api.ts';

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
// The bodies
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

export function firstCodeBlock(text: string): string {
  // Any info string (`javascript `, `js title="x"`, `c++`), Windows line ends,
  // and a close at the start of a line: code that writes "```" into a string
  // does not end its own block there. A close mid-line only when there is none.
  const plain = text.replace(/\r\n/g, '\n');
  const block = /```[^\n`]*\n([\s\S]*?)\n[ \t]*```/.exec(plain) ?? /```[^\n`]*\n([\s\S]*?)```/.exec(plain);
  return block?.[1].trim() ?? '';
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * The node's `prompt.md` as it is sent: its variables filled from what the
 * node holds, with *sample* where there is one (`brief.ts`). A request nobody
 * has written yet is said to be so, rather than sent as nothing after `Prompt:`.
 */
function filledPrompt(request: GenerateRequest, kind: BriefKind, sample?: Sample): string {
  const prompt = requestOf(request.prompt ?? '').trim() ? request.prompt : withRequest(request.prompt ?? '', '(not said yet)');
  return fillPrompt(prompt, promptVariables(request, kind, sample));
}

// ---------------------------------------------------------------------------
// Changing what there is
// ---------------------------------------------------------------------------

/** Said last in a request to change a body, so the request changes with it. */
const RESTATE = 'After that, restate the node\'s request in one or two sentences, inside <request></request> tags: what it does now, '
  + 'with the change. It replaces the request given above, after "Prompt:".';

/** The request a refined answer restated, and the answer without it. */
function requestIn(raw: string): { request?: string; rest: string } {
  const match = /<request>([\s\S]*?)<\/request>/.exec(raw);
  if (!match) return { rest: raw };
  const request = match[1].trim();
  return { ...(request ? { request } : {}), rest: `${raw.slice(0, match.index)}${raw.slice(match.index + match[0].length)}`.trim() };
}

/**
 * What changing a function is written from: the function as it is, what it
 * did on the sample, and what to change -- or, with nothing to change, how it
 * failed, in the repair step's own words (`repairPrompt`): ✨ Fix is the repair
 * a generation makes of its own first attempt, made of the body there is.
 */
function codeChange(refine: Refine, sample: Sample | undefined, outputs: string[]): string {
  const change = refine.change?.trim();
  if (!change) return repairPrompt(refine.body, sample?.values ?? {}, refine.error?.trim() ?? '', [], outputs, refine.problems ?? []);
  const on = sample ? ` on ${sample.origin}` : '';
  const parts = ['You are changing an existing function, not writing a new one.', '', '--- the function as it is now ---', refine.body.trim() || '(none yet)'];
  if (refine.outcome?.trim()) parts.push('', `--- what it returned${on} ---`, clip(refine.outcome, BUDGET.preview));
  if (refine.error?.trim()) parts.push('', `--- the error it raised${on} ---`, refine.error.trim());
  if (refine.problems?.length) parts.push('', '--- what is wrong with what it returned ---', ...refine.problems.map((problem) => `- ${problem}`));
  parts.push('', '--- what to change ---', change, '',
    `Change the function that way and keep everything else it does. Return the complete function, not a patch. ${RESTATE}`);
  return parts.join('\n');
}

/** The same for a system prompt, which is asked for inside `<system_prompt>` tags. */
function systemPromptChange(refine: Refine, sample: Sample | undefined): string {
  const change = refine.change?.trim();
  const on = sample ? ` on ${sample.origin}` : '';
  const parts = ['## The system prompt as it is now', refine.body.trim() || '(none yet)'];
  if (refine.outcome?.trim()) parts.push(`## What came of it${on}`, clip(refine.outcome, BUDGET.preview));
  if (refine.error?.trim()) parts.push(`## How it failed${on}`, refine.error.trim());
  if (refine.problems?.length) parts.push('## What is wrong with what came of it', refine.problems.map((problem) => `- ${problem}`).join('\n'));
  parts.push('## What to change', change || 'Only what makes it fail, or fall short, as said above.');
  parts.push(`Write the whole system prompt again with that change, keeping what it does not touch, inside <system_prompt> tags.${change ? ` ${RESTATE}` : ''}`);
  return parts.join('\n\n');
}

/**
 * Ask for code that maps *inputs* to *outputs*: the node's prompt, then the
 * skeleton to complete. *evidence* is a failed attempt and what went wrong
 * with it, for the repair -- or the function there is and what to change about
 * it (`codeChange`).
 */
async function generateCode(
  ai: AiService, target: Target, request: GenerateRequest, sample?: Sample, evidence = '',
): Promise<{ text: string; request?: string }> {
  const inputs = request.inputs ?? [];
  const outputs = request.outputs ?? [];
  const parts = [filledPrompt(request, 'code', sample)];
  if (evidence) parts.push(`\n${evidence}`);
  parts.push('\n## The function', 'Write the JavaScript function this node runs, as the prompt above asks.');
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
  const { request: restated, rest } = requestIn(await ai.complete({ prompt: parts.join('\n'), system: CODE_SYSTEM, ...target }));
  return { text: firstCodeBlock(rest) || rest, ...(restated ? { request: restated } : {}) };
}

/**
 * What a model's instructions are written to, after the node's prompt: the
 * instructions and the message they are sent with, each in its tags, and what
 * is added to them at run time without being asked.
 */
function instructionsFrame(inputs: string[]): string {
  const message = inputs.length
    ? `and how what is wired in is laid out in the message it is sent, inside <message_template></message_template> tags, with ${inputs.map((id) => `{{${id}}}`).join(', ')} standing for each input's value`
    : 'and leave <message_template></message_template> empty: nothing is wired in, so the instructions are the whole question';
  return `## What to write\nWrite the instructions for the model this node calls, inside <system_prompt></system_prompt> tags, ${message}. `
    + 'The instructions are sent every time the node runs, and the answer goes where the outputs go. The output definition '
    + '(output.md) is added after the instructions at run time, by itself: they need not repeat it, and must not contradict it.';
}

/**
 * A model's instructions, asked for inside `<system_prompt>` tags, the message
 * layout where one was written inside `<message_template>` tags, and the
 * request where one was restated.
 */
async function generateInstructions(ai: AiService, target: Target, prompt: string): Promise<{ text: string; message?: string; request?: string }> {
  const { request, rest } = requestIn(await ai.complete({ prompt, system: PROMPT_SYSTEM, ...target }));
  const instructions = /<system_prompt>([\s\S]*?)<\/system_prompt>/.exec(rest);
  const layout = /<message_template>([\s\S]*?)<\/message_template>/.exec(rest);
  // A model that ignores the tags falls back to the whole reply, which beats nothing.
  return {
    text: (instructions ? instructions[1] : rest).trim(),
    ...(layout ? { message: layout[1].trim() } : {}),
    ...(request ? { request } : {}),
  };
}

const PROMPT_SYSTEM =
  'You are an expert prompt engineer. Given what one node of a graph is sent, what its answer is for and what it '
  + 'should do, write concise, effective instructions for the model it calls. Output the instructions as plain text '
  + 'inside <system_prompt> tags -- and, where asked, the message layout inside <message_template> tags -- then a brief explanation.';

// ---------------------------------------------------------------------------
// An example, and an output definition
// ---------------------------------------------------------------------------

const EXAMPLE_SYSTEM =
  'You write example data for one node of a graph: what arrives at it, realistic and small, enough to show what it '
  + 'has to handle. Output ONLY one JSON object inside a ```json code block, keyed by the node\'s input ids.';

/** What an example is written to, after the node's prompt: one object, keyed by input id, a file where one is read. */
function exampleFrame(inputs: string[], reads: string[]): string {
  const lines = ['## What to write'];
  if (!inputs.length) {
    lines.push('Nothing is wired into this node: answer with {}.');
    return lines.join('\n');
  }
  lines.push(`Write one example of what arrives at this node: a JSON object keyed by input id -- ${inputs.map((id) => `"${id}"`).join(', ')} -- `
    + 'each with a value it could really be handed.');
  if (reads.length) {
    lines.push(`For an input that reads a file (${reads.map((id) => `"${id}"`).join(', ')}), give the file itself: `
      + '{ "file": "<a short name with its extension>", "content": "<the whole text of the file>" } -- or a list of those, '
      + `where a list of files arrives. Keep each file small: well under ${EXAMPLE_FILE_LIMIT / 1024} KB.`);
  }
  lines.push('Answer with the object alone, inside a ```json block.');
  return lines.join('\n');
}

/** *given* as a file name an example folder can hold: its last part, plain characters, an extension. */
function safeFileName(given: string, fallback: string): string {
  const last = given.replace(/\\/g, '/').split('/').pop() ?? '';
  const plain = last.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 80);
  if (!plain) return fallback;
  return /\.[A-Za-z0-9]+$/.test(plain) ? plain : `${plain}.txt`;
}

/**
 * The example a model wrote, as the node keeps it: its inputs, a file-reading
 * input's value the name of one of its example files ("example/<name>"), and
 * those files. What is not one of the node's inputs is left out; a file over
 * `EXAMPLE_FILE_LIMIT` is refused.
 */
function exampleIn(reply: string, request: GenerateRequest): { inputs: Record<string, unknown>; files: Record<string, string> } {
  const said = firstCodeBlock(reply) || reply.trim();
  let value: unknown;
  try {
    value = JSON.parse(said);
  } catch {
    throw new Error(`The example the model wrote is not JSON. It began: "${clip(said, 160)}".`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The example the model wrote is not an object keyed by input id.');
  }
  const reads = new Set(request.read_file_ports ?? []);
  const files: Record<string, string> = {};
  /** One file of *port*'s, kept under a name no other file has: what the input's value then names. */
  const kept = (port: string, item: unknown, index: number): string => {
    const file = item && typeof item === 'object' && !Array.isArray(item) ? item as { file?: unknown; content?: unknown } : undefined;
    const content = file ? file.content : item;
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? '', null, 2);
    const size = new TextEncoder().encode(text).length;
    if (size > EXAMPLE_FILE_LIMIT) {
      throw new Error(`The file the model wrote for "${port}" is ${Math.ceil(size / 1024)} KB, and an example file holds `
        + `at most ${EXAMPLE_FILE_LIMIT / 1024} KB. Ask for a smaller example, or give it one from a file.`);
    }
    const named = file ? String(file.file ?? '').trim() : '';
    const name = safeFileName(named || `${port}${index ? `_${index + 1}` : ''}.txt`, 'example.txt');
    const dot = name.lastIndexOf('.');
    let taken = `${EXAMPLE_DIR}/${name}`;
    for (let n = 2; taken in files; n += 1) taken = `${EXAMPLE_DIR}/${name.slice(0, dot)}_${n}${name.slice(dot)}`;
    files[taken] = text;
    return taken;
  };
  const inputs: Record<string, unknown> = {};
  for (const [port, given] of Object.entries(value as Record<string, unknown>)) {
    if (request.inputs && !request.inputs.includes(port)) continue;
    inputs[port] = !reads.has(port) ? given
      : Array.isArray(given) ? given.map((item, index) => kept(port, item, index)) : kept(port, given, 0);
  }
  return { inputs, files };
}

const OUTPUT_SYSTEM =
  'You write the output definition of one node of a graph: what each of its outputs holds and in what format, and '
  + 'an example of it. Plain Markdown, without a preamble.';

/** What an output definition is written to, after the node's prompt. */
function outputFrame(outputs: string[]): string {
  return '## What to write\nWrite this node\'s output definition, in Markdown: for each output'
    + `${outputs.length ? ` (${outputs.map((id) => `\`${id}\``).join(', ')})` : ''} what it holds and its format, `
    + 'then an example of what comes out, inside a ```json block keyed by output id. What its output definition says '
    + 'now (above) is the person\'s own brief: keep what it says, in substance, and make it complete. '
    + 'Answer with the definition alone.';
}

/**
 * The definition a model wrote, without a fence around the whole of it: one
 * marked Markdown may hold the example's fence inside it; any other is taken
 * off only when it is the only one there.
 */
function unfenced(reply: string): string {
  const said = reply.trim();
  const whole = /^```([^\n`]*)\n([\s\S]*?)\n?```$/.exec(said);
  if (!whole) return said;
  const markdown = /^(markdown|md)$/i.test(whole[1].trim());
  const fences = said.split('\n').filter((line) => /^\s*```/.test(line)).length;
  return markdown || fences === 2 ? whole[2].trim() : said;
}

// ---------------------------------------------------------------------------
// A node that runs once per item
// ---------------------------------------------------------------------------

/** Whether a run calls this body once per item. */
function runsPerItem(request: GenerateRequest): boolean {
  return request.batch_mode === 'per_item';
}

/**
 * The node's inputs as the executor fans them out, for its own rule
 * (`batchItems`): only the ports, which is all it reads.
 *
 * A run fans out over the inputs declared multi, and the request says which
 * those are (`multi_inputs`) -- not a guess from what the body is handed on
 * each port, which cut a list arriving on a single-valued port as if it
 * fanned out.
 */
function fannedOut(request: GenerateRequest, sample: Record<string, unknown>): GraphNode {
  const fans = (id: string) => request.multi_inputs?.includes(id) ?? false;
  return { inputs: Object.keys(sample).map((id) => port(id, id, 'input', 'any', fans(id))) } as GraphNode;
}

/**
 * The sample as one call of a per-item body meets it: the first item, and how
 * many a run would call it for. Undefined when there is nothing to cut.
 *
 * A sample is what came off the wires, so for a node run once per item it is
 * the whole list. Shown and tried whole, the model read "a list of 2" and a
 * skeleton typing it `string[]` while `run` is handed one string; a correct
 * body failed the probe on `toUpperCase is not a function`, and the repair
 * turned it into list code that then failed on every item of a real run. So
 * it is cut by the rule the executor cuts by. An empty list is no call at
 * all, and so no sample.
 */
function oneItem(request: GenerateRequest): { values: Record<string, unknown> | null; items: number } | undefined {
  const sample = request.sample_inputs;
  if (!sample) return undefined;
  const node = fannedOut(request, sample);
  if (!node.inputs.some((input) => input.multi && Array.isArray(sample[input.id]))) return undefined;
  const items = batchItems(node, sample);
  return { values: items[0] ?? null, items: items.length };
}

/**
 * What a node run once per item hands on, from the one item the probe ran.
 *
 * The executor collects every item's answer into a list, so the next node is
 * handed a list where one call returned a value -- and the shape kept from a
 * probe is what that node is generated against and what every later run is
 * checked against. Kept as one call's shape, a correct per-item node was
 * told on each run that it "does not match its output interface". The items
 * the probe did not run are answers that add nothing.
 *
 * An output declared multi (`multi_outputs`) is collected as a run collects
 * it: a list one call returns adds its entries, and even a single item is
 * handed on as a list of one -- a run of one item is still a run per item.
 * One declared single keeps a lone answer as it came.
 */
function handedOn(request: GenerateRequest, result: Record<string, unknown>): Record<string, unknown> {
  const multi = (id: string) => request.multi_outputs?.includes(id) ?? false;
  const node = { outputs: Object.keys(result).map((id) => port(id, id, 'output', 'any', multi(id))) } as GraphNode;
  return mergeBatchOutputs(node, [result]);
}

// ---------------------------------------------------------------------------
// Verify and repair
// ---------------------------------------------------------------------------

/** A probe is a smoke test, not a run: longer than this on one sample is not something a repair fixes. */
const PROBE_TIMEOUT_MS = 25_000;

/** The report of a probe that did not run: no sample to try on, or a body no probe tries. A fresh one each time. */
const notProbed = (): ProbeReport => ({ status: 'skipped', error: '', missing_outputs: [] });

/**
 * Each input as the repair is shown it: the brief's own rendering (`shown`),
 * so one prompt says a value -- and a list's length -- one way. A single
 * value is named by its type too: "string", said outright, is what turns a
 * body written for a list back into one written for an item.
 */
function describeInputs(sample: Record<string, unknown>): string {
  return Object.entries(sample).map(([key, value]) => {
    const kind = Array.isArray(value) ? '' : `${value === null ? 'null' : typeof value} = `;
    return `  inputs["${key}"]: ${kind}${shown(value, BUDGET.preview)}`;
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
    // What it asks is answered by the model that wrote it, which is the one
    // AI setting -- where the same call in a run goes, too.
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

/**
 * The evidence block handed to the second pass. *change* is what the attempt
 * was written to change, in the person's words: a repair of a change that
 * does not say so is a repair of the body from before it, and turned it back.
 */
function repairPrompt(
  body: string, sample: Record<string, unknown>, error: string, missing: string[], outputs: string[], problems: string[] = [], change = '',
): string {
  const parts = [
    'Your previous attempt was executed against real data and did not work. Fix it. Return the complete corrected function, not a patch.',
    '', '--- your previous attempt ---', body,
  ];
  if (change) parts.push('', '--- the change it was written to make, which the fix keeps ---', change);
  parts.push('', '--- the inputs it actually received ---', describeInputs(sample) || '  (no inputs)');
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
 * something worse than the first attempt. *change* is what the first pass is
 * written from beside the prompt, when it changes a body rather than writing
 * one (`codeChange`); the request it restated comes back whichever pass is kept.
 */
async function generateVerifiedCode(
  ai: AiService, runtime: Runtime, target: Target, request: GenerateRequest,
  given: Sample | undefined, change = '',
): Promise<{ text: string; request?: string; probe: ProbeReport }> {
  const outputs = request.outputs ?? [];
  const sample = given?.values;
  const first = await generateCode(ai, target, request, given, change);
  if (!sample || !Object.keys(sample).length) return { ...first, probe: notProbed() };
  const perItem = runsPerItem(request);
  // What the person asked to change, when this is a change.
  const asked = request.refine?.change?.trim() ?? '';
  // A sample that is an example says what must come out of it, and that is
  // checked too -- an example is a test, and a body that returns the right
  // keys with the wrong contents has not passed it. Not when the probe ran
  // one item of several: that returns one item's result, not what the
  // example expects of the whole node. And not for a change: the example was
  // written before it, and "return it in upper case" fails an example that
  // expects lower case -- the repair then turned the change back while the
  // request said it was made. Try it holds the changed body to the example, and
  // Keep makes what it gives the example's expectation.
  const expect = !asked && given?.expect && (given.items ?? 1) <= 1 ? given.expect : undefined;
  /**
   * What an example's expectation is short of. It says what the node hands
   * on, which is what `test` holds it to -- for a node run once per item, the
   * one call's answer collected into a list. Held to the bare answer instead,
   * a correct body failed an example kept from a run of one item.
   */
  const gaps = (result: Record<string, unknown>): string[] => (
    expect ? unmet(expect, perItem ? handedOn(request, result) : result) : []
  );

  /**
   * Run it, then ask three questions in order: did it run, did it return the
   * right keys, and -- when the sample is an example -- did it return what the
   * example expects.
   */
  const judge = async (body: string) => {
    const ran = await probe(runtime, target, body, sample);
    const missing = ran.result ? outputs.filter((port) => !(port in ran.result!)) : [];
    const problems = ran.result && !missing.length
      ? gaps(ran.result).map((gap) => `for ${given!.origin}, ${gap}`)
      : [];
    // How far it got: not at all, wrong keys, a flawed result, a good one.
    const reached = !ran.result ? 0 : missing.length ? 1 : problems.length ? 2 : 3;
    return { ...ran, missing, problems, reached };
  };
  const reportOf = (verdict: Awaited<ReturnType<typeof judge>>, status: ProbeReport['status']): ProbeReport => {
    // Handed on as the node hands it on: the shape kept from a probe is what
    // the next node is generated against, and a run checks itself against it.
    const outputs = verdict.result && perItem ? handedOn(request, verdict.result) : verdict.result ?? undefined;
    return {
      status, error: verdict.error, missing_outputs: verdict.missing, problems: verdict.problems,
      ...(outputs ? { outputs } : {}),
    };
  };

  const attempt = await judge(first.text);
  if (attempt.reached === 3) return { ...first, probe: reportOf(attempt, 'ok') };

  const evidence = repairPrompt(first.text, sample, attempt.error, attempt.missing, outputs, attempt.problems, asked);
  // A change is repaired as the request it restated, which says the change;
  // the request from before it asks for the body the change was to replace.
  const repairing = asked && first.request ? { ...request, prompt: withRequest(request.prompt ?? '', first.request) } : request;
  let second: { text: string };
  try {
    second = await generateCode(ai, target, repairing, given, evidence);
  } catch {
    // The repair pass is a bonus, never a reason to fail the request.
    return { ...first, probe: reportOf(attempt, 'failed') };
  }
  // The repair is asked for code alone: what the change made of the request stands.
  const repaired = { text: second.text, ...(first.request ? { request: first.request } : {}) };
  const again = await judge(second.text);
  if (again.reached === 3) return { ...repaired, probe: reportOf(again, 'repaired') };
  // Still not right. Keep the attempt that got further -- one that misses an
  // example beats one that does not run -- and say what remains.
  return again.reached >= attempt.reached
    ? { ...repaired, probe: reportOf(again, 'failed') }
    : { ...first, probe: reportOf(attempt, 'failed') };
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

export interface GenerateDeps {
  ai: AiService;
  code: CodeService;
  /**
   * Reads the files a sample names, for a node that is handed their text --
   * after the node's own example files (`GenerateRequest.example_files`).
   * Without either, the sample stays as sent.
   */
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

/** What `GenerateRequest.write` may ask for. */
const WRITES = ['body', 'example', 'output'] as const;

/** Generate one node's authored text, whatever kind of node it is: its body, an example, or its output definition. */
export async function generate(given: GenerateRequest, deps: GenerateDeps): Promise<GenerateResponse> {
  // The error port is the executor's (`catch_errors`): filled when the body
  // fails, never returned by it. Left in, the skeleton returned it and the
  // rule said the keys must include it, so correct code was reported as
  // missing a key and "repaired". Dropped once, here, where every caller's
  // request comes in, so the skeleton, the rule, the probe and the prompt all
  // see the same outputs.
  const asked = given.outputs ? { ...given, outputs: given.outputs.filter((id) => id !== ERROR_PORT) } : given;
  // Real data when the graph has run; the first example's inputs when it has
  // not -- an example is the person saying what arrives. Either is read as a
  // run would read it (`asReceived`), shown in the prompt and tried the code on.
  const ran = asked.sample_inputs && Object.keys(asked.sample_inputs).length;
  const exampled = ran ? undefined : exampleSample(asked.examples);
  // What is written, and how, is the element's to say: a request that names
  // none has nobody to ask.
  if (!asked.element) throw new GenerationRefused('A generation names the element it writes for.');
  const spec = deps.generationFor(asked.element);
  if (!spec) throw new GenerationRefused(`'${asked.element}' is not an element that generates anything`);
  const write = asked.write ?? 'body';
  if (!(WRITES as readonly string[]).includes(write)) {
    throw new GenerationRefused(`'${String(write)}' is nothing ✨ writes: it writes a node's ${WRITES.join(', ')}.`);
  }
  // The node's own example files first: an example that reads a file names one of them.
  const own = exampleFilesOf({ config: { example_files: asked.example_files } });
  const files = deps.files || Object.keys(own).length ? withExampleFiles(deps.files ?? NO_FILES, own) : undefined;
  const whole = exampled ? { ...asked, sample_inputs: exampled.values } : asked;
  // One item of it, for a node run once per item: what its body is called with.
  const cut = runsPerItem(whole) ? oneItem(whole) : undefined;
  // An example is written from what the node knows, not copied from a sample of it.
  const request = write === 'example' ? { ...asked, sample_inputs: null }
    : await asReceived(cut ? { ...whole, sample_inputs: cut.values } : whole, files);
  const calls: AICall[] = deps.calls ?? [];
  // A preview runs every step a generation does up to the model, and stops
  // there: the request it hands back is the request, not a second rendering
  // of it that could differ.
  const ai = recording(request.preview ? PREVIEW_AI : deps.ai, calls);
  const kind = spec.kind;

  const values = request.sample_inputs;
  const sample: Sample | undefined = values && Object.keys(values).length
    ? {
      values, origin: exampled?.origin ?? request.sample_origin ?? 'the last run', expect: exampled?.expect,
      ...(cut ? { items: cut.items } : {}),
    }
    : undefined;

  // A change to a body is written from the same prompt as a body from
  // nothing, with the body there is, what came of it and what to change beside
  // it -- and only a change restates the request: nothing else asks for it,
  // and a request a model offered unasked is not written over the person's.
  const { refine } = request;
  const restated = (said: string | undefined) => (said && refine?.change?.trim() ? { request: said } : {});
  try {
    // What arrives, and what goes out: written from the same prompt, and
    // never run -- they are what a body is then written against and tried on.
    if (write === 'example') {
      const prompt = [filledPrompt(request, kind), exampleFrame(request.inputs ?? [], request.read_file_ports ?? [])].join('\n\n');
      const reply = await ai.complete({ prompt, system: EXAMPLE_SYSTEM, ...deps.target });
      return { result: '', example: exampleIn(reply, request), probe: notProbed(), calls };
    }
    if (write === 'output') {
      const prompt = [filledPrompt(request, kind, sample), outputFrame(request.outputs ?? [])].join('\n\n');
      const reply = await ai.complete({ prompt, system: OUTPUT_SYSTEM, ...deps.target });
      return { result: unfenced(reply), probe: notProbed(), calls };
    }
    switch (kind) {
      case 'code': {
        const change = refine ? codeChange(refine, sample, request.outputs ?? []) : '';
        const probing = { code: deps.code, ai, files: files ?? NO_FILES };
        const { text, request: said, probe: report } = await generateVerifiedCode(ai, probing, deps.target, request, sample, change);
        return { result: text, probe: report, calls, ...restated(said) };
      }
      case 'prompt': {
        // The same prompt a code node's body is written from: instructions
        // are written for a model that is sent these inputs, and whose answer
        // goes where the outputs go. A change keeps the message as it is.
        const prompt = [
          filledPrompt(request, 'prompt', sample),
          refine ? systemPromptChange(refine, sample) : instructionsFrame(request.inputs ?? []),
        ].join('\n\n');
        const { text, message, request: said } = await generateInstructions(ai, deps.target, prompt);
        return {
          result: text, ...(message !== undefined && !refine ? { message_template: message } : {}),
          probe: notProbed(), calls, ...restated(said),
        };
      }
      default:
        throw new GenerationRefused(`Unknown generation kind '${String(kind)}'`);
    }
  } catch (error) {
    if (error instanceof PreviewReached) {
      // Recorded as a failure by `recording`; it is not one.
      const last = calls.at(-1);
      if (last) last.error = null;
      return { result: '', probe: notProbed(), calls };
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
  description: string, deps: Pick<GenerateDeps, 'ai' | 'target' | 'calls'>,
): Promise<{ graph: unknown; explanation: string; calls: AICall[] }> {
  const calls: AICall[] = deps.calls ?? [];
  const ai = recording(deps.ai, calls);
  let raw: string;
  try {
    raw = await ai.complete({ prompt: `Design a graph that does the following:\n${description}`, system: GRAPH_SYSTEM, ...deps.target });
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
