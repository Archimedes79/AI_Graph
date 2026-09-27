import type { GraphNode, GuiWidget } from '@/graph';
import { call, type AICall, type GenerateRequest, type GenerateResponse, type ProbeReport } from '@/api/client';
import { genAI } from '@/store/settingsStore';
import type { GenerateOptions } from './useGenerate';
import type { Generation } from '@engine/authoring/generation.ts';

/**
 * The ✨ Generate button, declared by the element instead of written out by the
 * shell that draws it.
 *
 * There were five hand-written call sites: four handlers in NodeEditor.tsx,
 * passed to every Panel so each could pick the one prop it recognised;
 * an `isPlot` ternary threaded through eight lines of WidgetEditor.tsx; and
 * OutputFormatEditor's own. Which is why `image_view` had a `code` field with
 * the same contract as plot_window and no button at all -- nobody added the
 * sixth branch.
 *
 * What is NOT here is as important as what is. The generator kind, the contract
 * sentence describing what the engine will do with the snippet, and any fixed
 * port names live on the *engine* element (`Generation`, declared by each
 * element under `engine/src/elements/`) and are resolved server-side from the element's name.
 * A contract sentence copied into the editor would be a second copy of a
 * statement about engine behaviour, and a prompt that exists twice is a prompt
 * that will drift -- which is exactly what happened to the file-selector
 * sentence, which existed three times.
 */
/**
 * The half of a generation the engine already declared, in the editor's words.
 *
 * Which field holds the request, which the body, and what to say when the
 * request is missing or the answer arrived -- an element's `Generation` says
 * all of it, beside its `Logic`, from one constant. The editor's definition
 * adds only what the engine cannot know: labels, placeholders, and whether the
 * button is offered on this particular node.
 */
export function fromEngine(
  generation: Generation | undefined,
): Pick<ElementGeneration, 'promptField' | 'targetField' | 'language' | 'guard' | 'success'> {
  if (!generation) throw new Error('This element declares no generation in the engine; the editor cannot offer one.');
  return {
    promptField: generation.fields.promptOnSubject ? 'description' : generation.fields.prompt,
    targetField: generation.fields.body,
    // Code is JavaScript; a system prompt and a data format are prose -- the
    // rule `Logic.extension` gives a file holding the body, from the same kind.
    language: generation.kind === 'code' ? 'javascript' : 'markdown',
    guard: generation.guard,
    success: generation.success,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a node's and a widget's, held side by side
export interface ElementGeneration<S = any> {
  /**
   * Field holding the user's request. `'description'` means the node's own
   * description rather than a config key -- the ai node's request lives there.
   */
  promptField: string;
  /** Field the generated text is written into. */
  targetField: string;
  /**
   * Is there a body to write for this particular subject? Omitted means
   * always. An input node selects files only in directory mode; that is a
   * question about one node, not about the element, which is why it is here
   * and not in the backend descriptor. The graph sweep passes over a subject
   * that has none; a panel shows step 4, and so ✨, only where there is one.
   */
  available?: (subject: S) => boolean;
  /**
   * Context only the editor can know: what the user chose in this node's own
   * config (batch mode, declared output format). Everything about the *graph*
   * around the node is assembled once by the shell and passed in separately.
   */
  context?: (subject: S) => string;
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
  /**
   * A sample only the engine can produce, asked for when ✨ is pressed: a
   * folder's listing, which is what a file selector is handed and what no
   * field of the node holds. It wins over the node's own sample, which is keyed
   * by ports the snippet does not have.
   */
  fetchSample?: (subject: S) => Promise<{ values: Record<string, unknown>; origin: string } | undefined>;
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

/** A widget's fields: all flat on the widget, one level down. */
export function widgetFields(
  widget: GuiWidget,
  update: (patch: Partial<GuiWidget>) => void,
): FieldAccess {
  const flat = widget as unknown as Record<string, unknown>;
  return {
    get: (field) => String(flat[field] ?? ''),
    set: (field, value) => update({ [field]: value } as Partial<GuiWidget>),
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
 */
export function probeMessage(probe: ProbeReport | undefined, fallback: string, origin?: string): string {
  const on = origin ?? 'the sample';
  switch (probe?.status) {
    case 'ok':
      return `✅ Generated and verified against ${on}.`;
    case 'repaired':
      return `✅ Generated. The first attempt failed on ${on}; this one runs.`;
    case 'failed': {
      if (probe.error) return `⚠️ Generated, but it does not run yet: ${probe.error}`;
      if (probe.missing_outputs.length) return `⚠️ Generated, but it does not return ${probe.missing_outputs.join(', ')} yet.`;
      const problems = probe.problems ?? [];
      return problems.length
        ? `⚠️ Generated and it runs on ${on}, but the result is not right yet: ${problems.join('; ')}`
        : `⚠️ Generated, but it could not be verified against ${on}.`;
    }
    default:
      return fallback;
  }
}

export interface GenerationRequest<S> {
  /** NodeType or WidgetKind -- the server resolves the rest from it. */
  element: string;
  generation: ElementGeneration<S>;
  subject: S;
  fields: FieldAccess;
  /** The element's real ports, for a snippet that is wired as the node is. */
  ports?: { inputs: string[]; outputs: string[] };
  /**
   * The ports declared as lists (`Port.multi`): what a run per item fans out
   * over and collects into lists, and so how ✨'s probe cuts the sample to one
   * call and hands its answer on.
   */
  lists?: { inputs: string[]; outputs: string[] };
  /** Neighbours' declared formats and the last run's values, from the shell. */
  graphContext?: string;
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
  /** A result to imitate (`output.example.md`). */
  outputExample?: string;
  /**
   * Keep what the generated body actually returned, as the node's output
   * shape, when it has none yet.
   *
   * The backend ran it on a sample before handing it over, so this is a
   * measurement -- and exactly what the *next* node is generated against. It
   * used to be written into the node's format description as a sentence,
   * over the one field that is the person's own words; the shape is where a
   * measurement belongs (the node's `interface.json`), and a run would put it there
   * anyway. Only for a node: a block inside a page has no output of its own.
   */
  recordShape?: (outputs: Record<string, unknown>) => void;
}

/**
 * Turn an element's declaration into the options `useGenerate().run` takes.
 *
 * Both shells call exactly this, so a node and a widget generate through one
 * code path -- as they already execute, author files and declare ports through
 * one.
 */
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
export function generateRequest<S>(request: GenerationRequest<S>): GenerateRequest {
  const { generation: spec, subject, fields } = request;
  return {
    element: request.element,
    description: fields.get(spec.promptField).trim(),
    context: [spec.context?.(subject), request.graphContext].filter(Boolean).join('\n\n'),
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
    output_example: request.outputExample?.trim() || undefined,
    ...genAI(),
  };
}

/**
 * The request with the sample its element can only get by asking the engine
 * (`ElementGeneration.fetchSample`), when it declares one. Asked at the moment
 * ✨ is pressed, so it is what is there now; one that cannot be had leaves the
 * request as it was, and the verify pass is simply off.
 */
async function withFetchedSample<S>(request: GenerationRequest<S>): Promise<GenerationRequest<S>> {
  const fetch = request.generation.fetchSample;
  if (!fetch) return request;
  try {
    const fetched = await fetch(request.subject);
    return fetched ? { ...request, sampleInputs: fetched.values, sampleOrigin: fetched.origin } : request;
  } catch {
    return request;
  }
}

/**
 * What ✨ Generate would send, without sending it: the server builds the same
 * request and stops at the first model call (`preview`). The answer is that
 * call -- system and prompt, as the model would read them.
 */
export async function previewGeneration<S>(request: GenerationRequest<S>): Promise<AICall[]> {
  const response = await call('generate', { ...generateRequest(await withFetchedSample(request)), preview: true });
  return response.calls ?? [];
}

export function buildGeneration<S>(request: GenerationRequest<S>): GenerateOptions<GenerateResponse> {
  const { generation: spec, fields } = request;
  const prompt = fields.get(spec.promptField).trim();
  // What the verify pass ran it on, as the message after it says: set once the
  // request is sent, since a fetched sample is only known then.
  let origin = request.sampleOrigin;

  return {
    guard: () => (prompt ? undefined : (spec.guard ?? 'Please add a prompt first.')),
    pending: 'Generating…',
    success: (result) => probeMessage(result.probe, spec.success ?? '✅ Generated!', origin),
    failure: 'Generation failed',
    run: async (progressId?: string) => {
      const sent = await withFetchedSample(request);
      origin = sent.sampleOrigin;
      return call('generate', {
        ...generateRequest(sent),
        // Only a single ✨ button passes one; a sweep runs unattended.
        ...(progressId ? { progress_id: progressId } : {}),
      });
    },
    apply: (result) => {
      fields.set(spec.targetField, result.result);

      const outputs = result.probe?.outputs;
      if (request.recordShape && outputs && Object.keys(outputs).length) request.recordShape(outputs);
    },
  };
}
