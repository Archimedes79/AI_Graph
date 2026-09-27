import type { GraphNode } from '@/graph';
import { call, type AICall, type GenerateRequest, type GenerateResponse, type ProbeReport } from '@/api/client';
import type { GenerateOptions } from './useGenerate';
import type { Generation } from '@engine/authoring/generation.ts';
import type { Refine } from '@engine/host/api.ts';

/**
 * The ✨ Generate button, declared by the element instead of written out by the
 * shell that draws it.
 *
 * There were five hand-written call sites, passed to every Panel so each could
 * pick the one prop it recognised -- and an element one of them forgot had a
 * body and no button at all.
 *
 * What is NOT here is as important as what is. The generator kind lives on the
 * *engine* element (`Generation`, declared by each element under
 * `engine/src/elements/`) and is resolved server-side from the element's name:
 * a sentence about engine behaviour copied into the editor is a second copy,
 * and a prompt that exists twice is a prompt that will drift.
 */
/**
 * The half of a generation the engine already declared, in the editor's words.
 *
 * Which field holds the request, which the body, and what to say when the
 * request is missing or the answer arrived -- an element's `Generation` says
 * all of it, beside its `Logic`, from one constant. The editor's definition
 * adds only what the engine cannot know: labels and placeholders.
 */
export function fromEngine(
  generation: Generation | undefined,
): Pick<ElementGeneration, 'promptField' | 'targetField' | 'language' | 'guard' | 'success'> {
  if (!generation) throw new Error('This element declares no generation in the engine; the editor cannot offer one.');
  return {
    promptField: generation.fields.promptOnSubject ? 'description' : generation.fields.prompt,
    targetField: generation.fields.body,
    // Code is JavaScript; a system prompt is prose -- the rule
    // `Logic.extension` gives a file holding the body, from the same kind.
    language: generation.kind === 'code' ? 'javascript' : 'markdown',
    guard: generation.guard,
    success: generation.success,
  };
}

export interface ElementGeneration {
  /**
   * Field holding the user's request. `'description'` means the node's own
   * description rather than a config key -- the ai node's request lives there.
   */
  promptField: string;
  /** Field the generated text is written into. */
  targetField: string;
  /** Shown when the prompt field is empty. */
  guard?: string;
  /** Shown when it worked, unless the result has more to say (see probe). */
  success?: string;

  // ---- how the block is labelled -------------------------------------------
  // Seven editors drew the same controls -- a prompt box, an example, the ✨
  // button and the body box -- and differed only in their wording. The wording
  // belongs to the element; the drawing belongs to `FourSteps` and
  // `GeneratedBody`, which is why these live here rather than as props
  // somebody has to remember to pass.
  promptLabel?: string;
  promptPlaceholder?: string;
  bodyLabel?: string;
  bodyPlaceholder?: string;
  /**
   * What the body is written in, for the editor it is written with: the
   * engine's generation kind says (`fromEngine`). It was guessed from the
   * field's name -- a body in a field called `…prompt` was prose.
   */
  language: 'javascript' | 'markdown';
  /** How tall the body box starts out; a system prompt needs less than a module. */
  bodyHeight?: number;
}

/** Reading and writing one element's fields, wherever they happen to live. */
export interface FieldAccess {
  get(field: string): string;
  set(field: string, value: string): void;
}

/** A node's fields: config keys, plus `description` on the node itself. */
export function nodeFields(
  node: GraphNode,
  setConfig: (key: string, value: unknown) => void,
  setDescription: (value: string) => void,
): FieldAccess {
  const config = node.config as unknown as Record<string, unknown>;
  return {
    get: (field) => String((field === 'description' ? node.description : config[field]) ?? ''),
    set: (field, value) => (field === 'description' ? setDescription(value) : setConfig(field, value)),
  };
}


/**
 * What to say after generating.
 *
 * When a sample was available -- the example, the last run's values, what a
 * wired node holds -- the backend ran the function before handing it over, so
 * there is more to report than "done", and it says on *what*: "the last run's
 * data" was said whatever the sample had been. When it still does not run,
 * saying so now is kinder than letting the next ▶ Run say it; when it runs and
 * only the element's own check or the example's expected output found fault
 * with the result, it says that, and not that it does not run.
 *
 * *held*: whether the probe held it to what the example expects. A change is
 * not (`generate.ts`): the example was written before it, so a change that
 * runs has run on it, and Try it says whether it gives what that expects.
 */
export function probeMessage(probe: ProbeReport | undefined, fallback: string, origin?: string, done = 'Generated', held = true): string {
  const on = origin ?? 'the sample';
  switch (probe?.status) {
    case 'ok':
      return held ? `✅ ${done} and verified against ${on}.` : `✅ ${done}, and it runs on ${on}.`;
    case 'repaired':
      return `✅ ${done}. The first attempt failed on ${on}; this one runs.`;
    case 'failed': {
      if (probe.error) return `⚠️ ${done}, but it does not run yet: ${probe.error}`;
      if (probe.missing_outputs.length) return `⚠️ ${done}, but it does not return ${probe.missing_outputs.join(', ')} yet.`;
      const problems = probe.problems ?? [];
      return problems.length
        ? `⚠️ ${done} and it runs on ${on}, but the result is not right yet: ${problems.join('; ')}`
        : `⚠️ ${done}, but it could not be verified against ${on}.`;
    }
    default:
      return fallback;
  }
}

export interface GenerationRequest {
  /** The node type -- the server resolves the rest from it. */
  element: string;
  generation: ElementGeneration;
  fields: FieldAccess;
  /** The element's real ports, for a snippet that is wired as the node is. */
  ports?: { inputs: string[]; outputs: string[] };
  /**
   * The ports declared as lists (`Port.multi`): what a run per item fans out
   * over and collects into lists, and so how ✨'s probe cuts the sample to one
   * call and hands its answer on.
   */
  lists?: { inputs: string[]; outputs: string[] };
  /** Raw last-run values, for the backend's verify-and-repair pass. */
  sampleInputs?: Record<string, unknown>;
  /**
   * Which node feeds each input port, by label. Only the editor knows the
   * wiring, and it is what lets the generated skeleton say where a value came
   * from -- the part no type annotation can express.
   */
  inputSources?: Record<string, string>;
  /** Ports whose sample is a path the running node gets the text of (`readFilePorts`). */
  readFilePorts?: string[];
  /**
   * What the person wrote about each port, by port id: the one place a port's
   * meaning is said in words, and so the first thing the model should read
   * about it. Empty descriptions are left out.
   */
  portNotes?: { inputs?: Record<string, string>; outputs?: Record<string, string> };
  /** The output interface this node keeps (in its `interface.json`): the shape a body must go on returning. */
  outputSchema?: unknown;
  /** The node's examples (`examples.md`): what it is checked against, so what it is written to satisfy. */
  examples?: string;
  /** An ai node's message template: how its inputs are laid out for the model. */
  messageTemplate?: string;
  /**
   * Where the sample came from, in words: the example, the last run, what a
   * wired node holds. Sent with `sampleInputs`, and said in the message after
   * ✨ -- also when the sample is the node's example, which the engine reads
   * from `examples` itself so that it checks what the example expects.
   */
  sampleOrigin?: string;
  /** Each input's declared type as the body sees it: `text`, `list of text`. */
  inputTypes?: Record<string, string>;
  /** How a list input arrives: one item per run, or whole. */
  batchMode?: 'per_item' | 'whole_list';
  /** Where each output goes, and what the node there wants of it. */
  outputTargets?: Record<string, string>;
  /** The output format, in the person's words (`output.md`) -- sent whenever it says anything. */
  outputFormat?: string;
  /**
   * Change the body there is instead of writing one anew: "Say what to
   * change", or ✨ Fix with nothing to change but how it failed. What comes
   * back brings the task along, restated to fit, and both are written.
   */
  refine?: Refine;
  /**
   * Keep what the generated body actually returned, as the node's output
   * shape, when it has none yet.
   *
   * The backend ran it on a sample before handing it over, so this is a
   * measurement -- and exactly what the *next* node is generated against. It
   * used to be written into the node's format description as a sentence,
   * over the one field that is the person's own words; the shape is where a
   * measurement belongs (the node's `interface.json`), and a run would put it there
   * anyway.
   */
  recordShape?: (outputs: Record<string, unknown>) => void;
}

/**
 * What a panel asks of ✨ beyond writing the body anew (`NodePanelProps.onGenerate`):
 * a change to the body there is -- and the inputs what came of it came from,
 * where those are not step 1's example: a run's.
 */
export interface ChangeAsked {
  refine: Refine;
  sample?: { values: Record<string, unknown>; origin: string };
}

/** *request*, asked to change its body as *change* says, on the inputs that change came of. */
export function withChange(request: GenerationRequest, change: ChangeAsked | undefined): GenerationRequest {
  if (!change) return request;
  return {
    ...request,
    refine: change.refine,
    ...(change.sample ? { sampleInputs: change.sample.values, sampleOrigin: change.sample.origin } : {}),
  };
}

/** Only the entries that say something: an empty description is not a note. */
function said(notes: Record<string, string> | undefined): Record<string, string> | undefined {
  const kept = Object.entries(notes ?? {}).filter(([, text]) => text?.trim());
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/**
 * The request ✨ Generate sends, exactly -- built in one place, so "show what
 * ✨ sends" (`preview`) and the real button cannot describe two different
 * requests.
 */
export function generateRequest(request: GenerationRequest): GenerateRequest {
  const { generation: spec, fields } = request;
  return {
    element: request.element,
    description: fields.get(spec.promptField).trim(),
    inputs: request.ports?.inputs,
    outputs: request.ports?.outputs,
    sample_inputs: request.sampleInputs,
    input_sources: request.inputSources,
    read_file_ports: request.readFilePorts?.length ? request.readFilePorts : undefined,
    input_notes: said(request.portNotes?.inputs),
    output_notes: said(request.portNotes?.outputs),
    output_schema: request.outputSchema ?? undefined,
    examples: request.examples?.trim() || undefined,
    message_template: request.messageTemplate?.trim() || undefined,
    sample_origin: request.sampleInputs ? request.sampleOrigin : undefined,
    input_types: request.inputTypes,
    batch_mode: request.batchMode,
    multi_inputs: request.lists?.inputs,
    multi_outputs: request.lists?.outputs,
    output_targets: request.outputTargets && Object.keys(request.outputTargets).length ? request.outputTargets : undefined,
    output_format: request.outputFormat?.trim() || undefined,
    refine: request.refine,
  };
}

/**
 * What ✨ Generate would send, without sending it: the server builds the same
 * request and stops at the first model call (`preview`). The answer is that
 * call -- system and prompt, as the model would read them.
 */
export async function previewGeneration(request: GenerationRequest): Promise<AICall[]> {
  const response = await call('generate', { ...generateRequest(request), preview: true });
  return response.calls ?? [];
}

/**
 * Why *request* cannot be sent yet, or undefined. A body is written from the
 * task; a change needs something to change -- words, or how it failed -- and
 * no task: the task comes back with it.
 */
export function generationGuard(request: GenerationRequest): string | undefined {
  const { refine, generation: spec } = request;
  if (refine) return refine.change?.trim() || refine.error?.trim() || refine.problems?.length ? undefined : 'Say what to change first.';
  return request.fields.get(spec.promptField).trim() ? undefined : (spec.guard ?? 'Please add a prompt first.');
}

/**
 * Turn an element's declaration into the options `useGenerate().run` takes.
 * A node's dialog and the graph sweep both call exactly this, so a button and
 * a sweep generate through one code path -- and a change to the body there is
 * goes the same way, with its task written beside the body it came with.
 */
export function buildGeneration(request: GenerationRequest): GenerateOptions<GenerateResponse> {
  const { generation: spec, fields, refine } = request;
  const change = !!refine?.change?.trim();
  // What it did, in a word: written anew, changed as said, or repaired.
  const done = !refine ? 'Generated' : change ? 'Changed' : 'Fixed';

  return {
    guard: () => generationGuard(request),
    pending: refine ? 'Changing…' : 'Generating…',
    success: (result) => probeMessage(result.probe, refine ? `✅ ${done}.` : spec.success ?? '✅ Generated!', request.sampleOrigin, done, !change),
    failure: refine ? 'The change failed' : 'Generation failed',
    run: (progressId?: string) => call('generate', {
      ...generateRequest(request),
      // Only a single ✨ button passes one; a sweep runs unattended.
      ...(progressId ? { progress_id: progressId } : {}),
    }),
    apply: (result) => {
      fields.set(spec.targetField, result.result);
      // What it does now, said with the body that does it: the two change together.
      if (result.task?.trim()) fields.set(spec.promptField, result.task.trim());

      const outputs = result.probe?.outputs;
      if (request.recordShape && outputs && Object.keys(outputs).length) request.recordShape(outputs);
    },
  };
}
