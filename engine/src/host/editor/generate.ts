// Writing a node's files with a model.
//
// One entry point for every ✨: a node's input definition (input.js), its
// output definition (output.js), and its body -- code, an ai node's prompt, a
// data node's data. What is sent is a prompt -- the standard one for that ✨,
// or the node's own where someone changed it (`authoring/prompts.ts`) -- with
// its variables filled from what the node and the graph hold (`brief.ts`), and
// after it the frame this file owns: the file format and how to answer, which
// is what makes an answer usable and not what the person asks.
//
// A body can also be changed rather than written anew (`refine`): "Say what to
// change" sends the body there is, what came of it and what to change, and gets
// the body back with the node's text restated to fit it; ✨ Fix sends how it
// failed, and gets the repair a generation makes of its own first attempt. Same
// prompt, same verify-and-repair: not a second generator.
//
// Code is not one call. It is written, run once on the example in the node's
// input.js, held to its output.js, and repaired once with the evidence when
// that fails -- because a wrong output key is the single most common way
// generated code "works" and still delivers nothing, and all of it becomes
// knowable the moment the code executes. The second pass is not "try again";
// it is "here is exactly what went wrong", which is why one extra round is
// usually enough and why there is no third. A definition whose example cannot
// be read is sent back once the same way.
//
// Every call a generation makes is recorded and handed back: the editor shows
// what was sent, and keeps it in the node's history.md.

import type { AiRequest, AiService, CodeService, FileService, Runtime } from '../../elements/Runtime.ts';
import type { Runners } from '../../elements/NodeRunner.ts';
import { runBody } from '../../elements/body.ts';
import { PLAIN_ASK } from '../../elements/nodes/ai/ask.ts';
import type { Generation } from '../../authoring/generation.ts';
import { STANDARD_PROMPTS, fillPrompt, type PromptKind } from '../../authoring/prompts.ts';
import { definitionExample, misfits, type Definitions } from '../../authoring/definition.ts';
import { filePorts } from '../../execution/fileInputs.ts';
import { runsPerItem } from '../../execution/batching.ts';
import { ERROR_PORT } from '../../execution/wiring.ts';
import type { GraphNode } from '../../graph.ts';
import { renderSkeleton } from './skeleton.ts';
import { BUDGET, clip, shown, variables } from './brief.ts';
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
function recording(ai: AiService, calls: AICall[]): AiService {
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
// What is written, and how an answer is read
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

/** Who the model is told it is, for each thing it writes. */
const SYSTEMS: Record<PromptKind, string> = {
  input: 'You write one file of a node in a graph tool: its input definition, input.js -- a JSDoc typedef of what one call '
    + 'of the node is handed, then one example of it as plain JSON. Output only the file, in one ```js block.',
  output: 'You write one file of a node in a graph tool: its output definition, output.js -- a JSDoc typedef of what one '
    + 'call of the node returns, then one example of it as plain JSON. Output only the file, in one ```js block.',
  code: CODE_SYSTEM,
  prompt: 'You are an expert prompt engineer. You write the instructions one node of a graph tool gives a model every time '
    + 'it runs: concise, effective, and about the task. Output only the instructions, in one ```md block.',
  data: 'You write the data one node of a graph tool holds between runs: realistic, and shaped as the nodes it feeds want '
    + 'it. Output only the data, in one fenced block.',
};

export function firstCodeBlock(text: string): string {
  // Any info string (`javascript `, `js title="x"`, `c++`), Windows line ends,
  // and a close at the start of a line: code that writes "```" into a string
  // does not end its own block there. A close mid-line only when there is none.
  const plain = text.replace(/\r\n/g, '\n');
  const block = /```[^\n`]*\n([\s\S]*?)\n[ \t]*```/.exec(plain) ?? /```[^\n`]*\n([\s\S]*?)```/.exec(plain);
  return block?.[1].trim() ?? '';
}

/** The file a model wrote, out of its answer: its first fenced block, or the whole answer where it wrote none. */
function fileIn(reply: string): string {
  return firstCodeBlock(reply) || reply.trim();
}

/** Said last in a request to change a body, so the node's text changes with it. */
const RESTATE = 'After that, restate what this node does in one or two sentences, inside <description></description> tags: '
  + 'what it does now, with the change. It replaces the node description above.';

/** The text a changed body's answer restated, and the answer without it. */
function descriptionIn(raw: string): { description?: string; rest: string } {
  const match = /<description>([\s\S]*?)<\/description>/.exec(raw);
  if (!match) return { rest: raw };
  const description = match[1].trim();
  return { ...(description ? { description } : {}), rest: `${raw.slice(0, match.index)}${raw.slice(match.index + match[0].length)}`.trim() };
}

/** What the node is, as far as how to answer depends on it. */
interface Shape {
  inputs: string[];
  /** Without the executor's error port: filled when the body fails, never returned by it. */
  outputs: string[];
  /** The outputs wired to other nodes: their ids are what the wires use. */
  wired: string[];
  /** The inputs that are handed a file's text. */
  reads: string[];
  /** A list arrives one item at a time. */
  perItem: boolean;
  definitions: Definitions | undefined;
}

const quoted = (ids: string[]): string => ids.map((id) => `"${id}"`).join(', ');

/**
 * What a body is told about the empty window as well as the full one: a page
 * is drawn before anything was chosen, and a node that fails on nothing shows
 * an error where a person should see what to do.
 */
const EMPTY_INPUT = 'Handle an input that is missing or empty as well as a full one: then the output says what to do instead of failing -- '
  + 'a chart gets a figure with no points and a title saying what to choose, a text says what it waits for.';

/** The frame after the prompt: the file's format and how to answer. The engine's, not the person's to edit. */
function frame(kind: PromptKind, shape: Shape, node: GraphNode): string {
  const { inputs, outputs, wired, reads, perItem } = shape;
  const lines = ['## How to answer'];
  switch (kind) {
    case 'input': {
      lines.push('Answer with the whole file input.js, in one ```js block and nothing else:');
      if (!inputs.length) {
        lines.push('- it has no inputs: `/** @typedef {Object} Input */` and `module.exports = {};`.');
        break;
      }
      lines.push(`- first a JSDoc comment: \`@typedef {Object} Input\`, then one \`@property {type} <id> <what it is>\` for each input -- ${quoted(inputs)} -- saying its general format, as any value it may be handed has it;`,
        '- then `module.exports = <example>;`: one small, realistic example of what one call is handed, keyed by exactly those input ids, as plain JSON -- double-quoted keys and strings, no comments, no trailing commas.',
        // A model names an input by what it holds -- "text" -- where the node's is "input", and the example then names nothing that arrives.
        `Those ids are the node's inputs as they are named, and what is wired in arrives under them: keep each as it is -- ${quoted(inputs)} -- even where another name would say more.`);
      if (reads.length) lines.push(`An input that reads a file (${quoted(reads)}) is handed the file's text: its example is text in that file's format -- a few lines of it -- never a path.`);
      if (perItem) lines.push('A list arrives one item at a time: the example is one item.');
      break;
    }
    case 'output': {
      lines.push('Answer with the whole file output.js, in one ```js block and nothing else:',
        '- first a JSDoc comment: `@typedef {Object} Output`, then one `@property {type} <id> <what it holds>` for each output;',
        '- then `module.exports = <example>;`: what one call returns for the example input, keyed by the outputs, as plain JSON -- double-quoted keys and strings, no comments, no trailing commas.');
      lines.push(outputs.length
        ? `Its keys are the node's outputs, which are ${quoted(outputs)} now. Keep those ids${wired.length ? ` -- ${quoted(wired)} ${wired.length > 1 ? 'are' : 'is'} wired to other nodes, which read ${wired.length > 1 ? 'them' : 'it'} by that id` : ''}, and add or drop one only where the description asks for it.`
        : 'Its keys become the node\'s outputs: name each by what it holds.');
      if (perItem) lines.push('It is what one call returns: the calls\' answers are collected into lists by themselves.');
      break;
    }
    case 'code': {
      lines.push('Answer with the whole file code.js, in one ```js block: this function, completed. Keep its name, its `inputs` and the returned keys exactly as they are:',
        '', renderSkeleton(inputs, outputs));
      if (outputs.length) {
        lines.push(`The returned object's keys must be exactly: ${JSON.stringify(outputs)}. Downstream nodes look values up `
          + 'by these exact strings - do not rename, abbreviate, reorder, or invent additional keys, and include every one of them.');
      }
      if (reads.length) lines.push(`${quoted(reads)} ${reads.length > 1 ? 'are' : 'is'} handed the file's text, already read: read no files yourself.`);
      if (perItem) lines.push('`run` is called once per item: `inputs` holds one item, as in the example; what the calls return is collected into lists by themselves.');
      if (inputs.length) lines.push(EMPTY_INPUT);
      lines.push('Use only what Node has built in. There is no package manager and no `npm install`: `require` '
        + "and `import` of anything outside Node's own standard library will fail at run time.");
      break;
    }
    case 'prompt': {
      const json = !!shape.definitions?.output.trim();
      lines.push('Answer with the whole file prompt.md, in one ```md block and nothing else: the instructions the model is given every time this node runs.',
        inputs.length > 1 ? `What arrives is sent after them, each input under its port id: ${quoted(inputs)}.`
          : inputs.length ? 'What arrives is sent after them, as it is.' : 'Nothing is wired in: the instructions are the whole question.',
        'Put {Node Description} and {Output Definition} where they belong in the instructions: they are filled in when the node runs -- '
          + `the node description as above, and ${json ? 'its output definition, output.js, as above' : '"None: answer in plain text."'}.`,
        json ? 'The answer is parsed as a JSON object keyed as the output definition\'s example is, and each key handed on its own output: ask for that JSON object and nothing else -- not the file around the example.'
          : 'The answer is plain text, handed on as it is.');
      if (inputs.length) lines.push(`Say in the instructions how to answer an input that is missing or empty. ${EMPTY_INPUT}`);
      break;
    }
    case 'data': {
      lines.push(node.config.data_format === 'structure'
        ? 'Answer with what the node holds, in one ```json block, as plain JSON, and nothing else.'
        : 'Answer with what the node holds, in one ```text block, the text itself, and nothing else.');
      break;
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Changing what there is
// ---------------------------------------------------------------------------

/**
 * Each input as a repair is shown it (`shown`), so one prompt says a value --
 * and a list's length -- one way. A single value is named by its type too:
 * "string", said outright, is what turns a body written for a list back into
 * one written for an item.
 */
function describeInputs(sample: Record<string, unknown>): string {
  return Object.entries(sample).map(([key, value]) => {
    const kind = Array.isArray(value) ? '' : `${value === null ? 'null' : typeof value} = `;
    return `  inputs["${key}"]: ${kind}${shown(value, BUDGET.preview)}`;
  }).join('\n');
}

/**
 * The evidence handed to the second pass. *change* is what the attempt was
 * written to change, in the person's words: a repair of a change that does not
 * say so is a repair of the body from before it, and turned it back.
 */
function repairPrompt(body: string, sample: Record<string, unknown>, error: string, problems: string[], change = ''): string {
  const parts = [
    'Your previous attempt was executed on the example in input.js and did not work. Fix it. Return the complete corrected function, not a patch.',
    '', '--- your previous attempt ---', body,
  ];
  if (change) parts.push('', '--- the change it was written to make, which the fix keeps ---', change);
  parts.push('', '--- the inputs it actually received ---', describeInputs(sample) || '  (no inputs)');
  if (error) parts.push('', '--- the error it raised ---', error);
  if (problems.length) {
    parts.push('', '--- what is wrong with what it returned ---',
      'It ran, but what it returned does not fit the output definition (output.js) -- downstream nodes look values up by exactly its keys, in its shape:',
      ...problems.map((problem) => `- ${problem}`));
  }
  return parts.join('\n');
}

/**
 * What changing a function is written from: the function as it is, what it
 * did on its example, and what to change -- or, with nothing to change, how it
 * failed, in the repair step's own words (`repairPrompt`): ✨ Fix is the repair
 * a generation makes of its own first attempt, made of the body there is.
 */
function codeChange(refine: Refine, body: string, sample: Record<string, unknown> | undefined): string {
  const change = refine.change?.trim();
  if (!change) return repairPrompt(body, sample ?? {}, refine.error?.trim() ?? '', refine.problems ?? []);
  const parts = ['You are changing an existing function, not writing a new one.', '', '--- the function as it is now ---', body.trim() || '(none yet)'];
  if (refine.outcome?.trim()) parts.push('', '--- what it returned on its example ---', clip(refine.outcome, BUDGET.preview));
  if (refine.error?.trim()) parts.push('', '--- the error it raised on its example ---', refine.error.trim());
  if (refine.problems?.length) parts.push('', '--- what does not fit its output definition ---', ...refine.problems.map((problem) => `- ${problem}`));
  parts.push('', '--- what to change ---', change, '',
    `Change the function that way and keep everything else it does. Return the complete function, not a patch. ${RESTATE}`);
  return parts.join('\n');
}

/** The same for instructions or data, written again whole with the change. */
function bodyChange(refine: Refine, body: string, what: string): string {
  const change = refine.change?.trim();
  const parts = [`## ${what} as it is now`, body.trim() || '(none yet)'];
  if (refine.outcome?.trim()) parts.push('## What came of it on its example', clip(refine.outcome, BUDGET.preview));
  if (refine.error?.trim()) parts.push('## How it failed on its example', refine.error.trim());
  if (refine.problems?.length) parts.push('## What does not fit its output definition', refine.problems.map((problem) => `- ${problem}`).join('\n'));
  parts.push('## What to change', change || 'Only what makes it fail, or fall short, as said above.');
  parts.push(`Write it again whole, with that change, keeping what the change does not touch.${change ? ` ${RESTATE}` : ''}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Verify and repair
// ---------------------------------------------------------------------------

/** A probe is a smoke test, not a run: longer than this on one example is not something a repair fixes. */
const PROBE_TIMEOUT_MS = 25_000;

/** The report of a probe that did not run: nothing to try it on, or nothing that is tried. A fresh one each time. */
const notProbed = (): ProbeReport => ({ status: 'skipped', error: '', problems: [] });

/** A probe with no way to read files: what it asks a model cannot name one. */
const refuse = async (): Promise<never> => { throw new Error('No files here: this body is being tried on its example.'); };
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
      return { result: null, error: `The function did not finish within ${PROBE_TIMEOUT_MS / 1000}s on its example.` };
    }
    return { result: null, error: (error instanceof Error ? error.message : String(error)).trim() };
  } finally {
    clearTimeout(clock);
  }
}

/**
 * What one call is tried on: the example in the node's input.js -- nothing,
 * for a node that takes nothing in -- or undefined when there is none to try
 * it on: then it is written and not tried.
 */
function exampleOf(shape: Shape): Record<string, unknown> | undefined {
  const input = shape.definitions?.input ?? '';
  if (!input.trim()) return shape.inputs.length ? undefined : {};
  const read = definitionExample(input);
  return 'example' in read ? read.example : undefined;
}

/** The body a model wrote, out of its answer, and the text it restated where it was asked to. */
async function askForCode(ai: AiService, target: Target, prompt: string): Promise<{ text: string; description?: string }> {
  const { description, rest } = descriptionIn(await ai.complete({ prompt, system: CODE_SYSTEM, ...target }));
  return { text: fileIn(rest), ...(description ? { description } : {}) };
}

/**
 * Write code and, when there is an example, verify it by running it on that
 * and holding what it returns to the output definition.
 *
 * The code handed back is always the best one obtained: pass 2's if it improved
 * things, pass 1's otherwise -- a failed repair never leaves the user with
 * something worse than the first attempt. *prompt* puts a pass's evidence into
 * the prompt: *opening*, for the first -- a change to make, a failure to fix,
 * or nothing -- and for a repair, how the first attempt failed, written from
 * the text a change restated. *change* is the change asked for, which the
 * repair keeps.
 */
async function writeVerifiedCode(
  ai: AiService, runtime: Runtime, target: Target, shape: Shape,
  prompt: (evidence: string, description?: string) => string, opening: string, change: string,
): Promise<{ text: string; description?: string; probe: ProbeReport }> {
  const first = await askForCode(ai, target, prompt(opening));
  const sample = exampleOf(shape);
  if (!sample) return { ...first, probe: notProbed() };
  const output = shape.definitions?.output ?? '';

  /** Run it, then ask: did it run, did it return every output, does it fit output.js. */
  const verdict = async (body: string) => {
    const ran = await probe(runtime, target, body, sample);
    const missing = ran.result ? shape.outputs.filter((port) => !(port in ran.result!)) : [];
    const problems = ran.result
      ? [...missing.map((port) => `it returns no "${port}"`), ...misfits(ran.result, output).filter((line) => !missing.some((port) => line === `output.${port} is missing`))]
      : [];
    // How far it got: not at all, with its keys wrong, or all the way.
    const reached = !ran.result ? 0 : problems.length ? 1 : 2;
    return { ...ran, problems, reached };
  };
  const reportOf = (found: Awaited<ReturnType<typeof verdict>>, status: ProbeReport['status']): ProbeReport => (
    { status, error: found.error, problems: found.problems }
  );

  const attempt = await verdict(first.text);
  if (attempt.reached === 2) return { ...first, probe: reportOf(attempt, 'ok') };

  let second: { text: string };
  try {
    // A change is repaired as the text it restated, which says the change; the
    // text from before it asks for the body the change was to replace.
    second = await askForCode(ai, target, prompt(repairPrompt(first.text, sample, attempt.error, attempt.problems, change), first.description));
  } catch {
    // The repair pass is a bonus, never a reason to fail the request.
    return { ...first, probe: reportOf(attempt, 'failed') };
  }
  // The repair is asked for code alone: what the change made of the text stands.
  const repaired = { text: second.text, ...(first.description ? { description: first.description } : {}) };
  const again = await verdict(second.text);
  if (again.reached === 2) return { ...repaired, probe: reportOf(again, 'repaired') };
  // Still not right. Keep the attempt that got further -- one that misses a
  // key beats one that does not run -- and say what remains.
  return again.reached >= attempt.reached
    ? { ...repaired, probe: reportOf(again, 'failed') }
    : { ...first, probe: reportOf(attempt, 'failed') };
}

/**
 * What is wrong with a definition a model wrote: its example cannot be read,
 * an input.js names an input the node does not have, an output.js leaves out
 * an output other nodes are wired to.
 */
function definitionFaults(kind: 'input' | 'output', text: string, shape: Shape): string[] {
  const read = definitionExample(text);
  if ('problem' in read) return [`Its example cannot be read: ${read.problem}.`];
  const keys = Object.keys(read.example);
  if (kind === 'input') {
    const stray = keys.filter((key) => !shape.inputs.includes(key));
    return stray.length ? [`It names ${quoted(stray)}, which ${stray.length > 1 ? 'are' : 'is'} not among the inputs: ${quoted(shape.inputs) || 'none'}.`] : [];
  }
  const lost = shape.wired.filter((port) => !keys.includes(port));
  return lost.length ? [`It leaves out ${quoted(lost)}, which other nodes are wired to and read by that id.`] : [];
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

interface GenerateDeps {
  ai: AiService;
  code: CodeService;
  /** Reads the files ✨ Input and ✨ Output are given, where the request does not bring their text. */
  files?: FileService;
  /** The elements, asked what a node's kind writes and whether it has definitions. */
  elements: Runners;
  target: Target;
  /**
   * Where to write the transcript, if somebody is watching it.
   *
   * A generation is several calls -- write, probe, repair -- over a minute or
   * more, and until it returns there is nothing to see. Handing the array in
   * lets a caller read it while it fills, which is what the editor polls to
   * show the prompt and each step as they happen.
   */
  calls?: AICall[];
}

/** What `GenerateRequest.write` may ask for. */
const WRITES = ['input', 'output', 'body'] as const;

/** Each file's text, the start of it, read here where the request did not bring it; one that cannot be read, said so. */
async function withTexts(given: { path: string; text?: string }[] | undefined, files: FileService | undefined): Promise<{ path: string; text?: string }[] | undefined> {
  if (!given?.length || !files) return given;
  return Promise.all(given.map(async (file) => {
    if (file.text !== undefined || !file.path.trim()) return file;
    try {
      return { path: file.path, text: (await files.read(file.path)).slice(0, BUDGET.files + 1) };
    } catch {
      return file;
    }
  }));
}

/** Write one of a node's files, whatever kind of node it is: its input definition, its output definition, or its body. */
export async function generate(given: GenerateRequest, deps: GenerateDeps): Promise<GenerateResponse> {
  const node = given.node as GraphNode | undefined;
  if (!node?.node_type) throw new GenerationRefused('A generation names the node it writes for.');
  const element = deps.elements.node(node.node_type);
  const spec: Generation | undefined = element?.generation();
  if (!element || !spec) throw new GenerationRefused(`A ${node.node_type} node has nothing ✨ writes.`);
  const write = given.write ?? 'body';
  if (!(WRITES as readonly string[]).includes(write)) {
    throw new GenerationRefused(`'${String(write)}' is nothing ✨ writes: it writes a node's ${WRITES.join(', ')}.`);
  }
  const definitions = element.definitions(node);
  if (write !== 'body' && !definitions) throw new GenerationRefused(`A ${node.node_type} node has no input or output definition.`);

  const request = write === 'input' ? { ...given, input_files: await withTexts(given.input_files, deps.files) }
    : write === 'output' ? { ...given, output_files: await withTexts(given.output_files, deps.files) } : given;
  const kind: PromptKind = write === 'body' ? spec.kind : write;
  const shape: Shape = {
    inputs: node.inputs.map((port) => port.id),
    // The error port is the executor's (`catch_errors`): filled when the body
    // fails, never returned by it. Left in, the skeleton returned it and the
    // rule said the keys must include it, so correct code was reported as
    // missing a key and "repaired".
    outputs: node.outputs.map((port) => port.id).filter((id) => id !== ERROR_PORT),
    wired: Object.keys(request.output_targets ?? {}).filter((id) => id !== ERROR_PORT),
    reads: filePorts(node, deps.elements),
    perItem: runsPerItem(node, element.batchMode(node)),
    definitions,
  };
  const own = (node.config.prompts as Partial<Record<string, string>> | undefined)?.[write];
  const template = own?.trim() ? own : STANDARD_PROMPTS[kind];
  const values = variables(request, shape.reads);
  /** The prompt as sent: the template filled -- with the text a change restated, for its repair -- then *evidence*, then the frame. */
  const prompt = (evidence: string, description?: string): string => [
    fillPrompt(template, description ? variables({ ...request, node: { ...node, description } }, shape.reads) : values),
    evidence, frame(kind, shape, node),
  ].filter(Boolean).join('\n\n');

  const calls: AICall[] = deps.calls ?? [];
  // A preview runs every step a generation does up to the model, and stops
  // there: the request it hands back is the request, not a second rendering
  // of it that could differ.
  const ai = recording(request.preview ? PREVIEW_AI : deps.ai, calls);
  const { refine } = request;
  const held = node.config[spec.fields.body];
  const body = typeof held === 'string' ? held : held === undefined || held === null ? '' : JSON.stringify(held, null, 2);
  // Only a change restates the text: nothing else asks for it, and a text a
  // model offered unasked is not written over the person's.
  const restated = (said: string | undefined) => (said && refine?.change?.trim() ? { description: said } : {});

  try {
    if (write === 'input' || write === 'output') {
      const ask = async (evidence: string) => fileIn(await ai.complete({ prompt: prompt(evidence), system: SYSTEMS[kind], ...deps.target }));
      let text = await ask('');
      let faults = definitionFaults(write, text, shape);
      if (faults.length) {
        // Once, with what is wrong: a definition nobody can read is no definition.
        const again = await ask(`Your last answer was this file:\n\n${text}\n\nIt cannot be used as it is: ${faults.join(' ')} Write the whole file again, corrected.`);
        const left = definitionFaults(write, again, shape);
        if (left.length <= faults.length) [text, faults] = [again, left];
      }
      return { result: text, probe: faults.length ? { status: 'failed', error: '', problems: faults } : notProbed(), calls };
    }
    if (kind === 'code') {
      const opening = refine ? codeChange(refine, body, exampleOf(shape)) : '';
      const probing = { code: deps.code, ai, files: NO_FILES };
      const written = await writeVerifiedCode(ai, probing, deps.target, shape, prompt, opening, refine?.change?.trim() ?? '');
      return { result: written.text, probe: written.probe, calls, ...restated(written.description) };
    }
    const what = kind === 'prompt' ? 'The instructions (prompt.md)' : 'What the node holds';
    const reply = await ai.complete({ prompt: prompt(refine ? bodyChange(refine, body, what) : ''), system: SYSTEMS[kind], ...deps.target });
    const { description, rest } = descriptionIn(reply);
    const text = fileIn(rest);
    if (kind === 'data' && node.config.data_format === 'structure') {
      try {
        JSON.parse(text);
      } catch (error) {
        throw new Error(`The data the model wrote is not JSON (${(error as Error).message}). It began: "${clip(text, 160)}".`);
      }
    }
    return { result: text, probe: notProbed(), calls, ...restated(description) };
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

type Graph = import('../../graph.ts').Graph;

/**
 * What a change to *current* is asked with: the graph as the document the
 * model writes, and the whole document back. Asked for a patch, a model makes
 * up a format of its own; asked for the document it knows, it keeps what it
 * was shown.
 */
function changePrompt(current: Graph, description: string): string {
  return [
    `This is the graph as it is now:\n\`\`\`json\n${JSON.stringify(current, null, 2)}\n\`\`\``,
    `Change it as follows:\n${description}`,
    'Answer with the whole graph after the change, as one complete document of the same shape. Keep every '
      + 'node\'s id, and keep everything the change does not touch -- nodes, wires, positions, labels, settings, '
      + 'code and prompts -- exactly as it is. A new node gets an id no other node has.',
  ].join('\n\n');
}

/**
 * *answer* with what it left out of *current* put back: the graph's name and
 * scheme, where each node it kept stands, and the size a page was drawn at.
 * Left out, each fell to its default -- a change to one node renamed the tool
 * and moved every node into the corner.
 */
function keptFrom(current: Graph, answer: unknown): unknown {
  if (!answer || typeof answer !== 'object') return answer;
  const document = answer as { metadata?: object; nodes?: unknown };
  const before = new Map(current.nodes.map((node) => [node.id, node]));
  const nodes = Array.isArray(document.nodes)
    ? document.nodes.map((node: Record<string, unknown>) => {
      const was = node && typeof node === 'object' ? before.get(String(node.id)) : undefined;
      if (!was) return node;
      const kept = { ...node };
      for (const key of ['position', 'width', 'height'] as const) if (kept[key] === undefined) kept[key] = was[key];
      return kept;
    })
    : document.nodes;
  return { ...document, metadata: { ...current.metadata, ...(document.metadata ?? {}) }, nodes };
}

/**
 * Ask for a whole Graph DSL document: one designed from *description* -- or,
 * given the graph there is (*current*), that graph changed as *description*
 * says, its ids and whatever the change does not touch kept. A graph with no
 * nodes yet is designed, under its name. The caller parses the document.
 */
export async function generateGraph(
  description: string, deps: Pick<GenerateDeps, 'ai' | 'target' | 'calls'>, current?: Graph,
): Promise<{ graph: unknown; explanation: string; calls: AICall[] }> {
  const calls: AICall[] = deps.calls ?? [];
  const ai = recording(deps.ai, calls);
  const prompt = current?.nodes.length
    ? changePrompt(current, description)
    : `Design a graph that does the following:\n${description}`;
  let raw: string;
  try {
    raw = await ai.complete({ prompt, system: GRAPH_SYSTEM, ...deps.target });
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
  return {
    graph: current ? keptFrom(current, graph) : graph,
    explanation: fenced ? raw.slice(fenced.index + fenced[0].length).trim() : '',
    calls,
  };
}
