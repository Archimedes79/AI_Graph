import type { GraphNode, GuiWidget } from '../../types/graph';
import { generate, type CodeProbeReport, type GenerationResult } from '../../utils/api';
import { genAI } from '../../store/settingsStore';
import type { GenerateOptions } from './useGenerate';

/**
 * The ✨ Generate button, declared by the element instead of written out by the
 * shell that draws it.
 *
 * There were five hand-written call sites: four handlers in NodeEditor.tsx,
 * passed to every ConfigEditor so each could pick the one prop it recognised;
 * an `isPlot` ternary threaded through eight lines of GuiWidgetEditor.tsx; and
 * OutputFormatEditor's own. Which is why `image_view` had a `code` field with
 * the same contract as plot_window and no button at all -- nobody added the
 * sixth branch.
 *
 * What is NOT here is as important as what is. The generator kind, the contract
 * sentence describing what the engine will do with the snippet, and any fixed
 * port names live on the *backend* element (`Generation` in
 * `app/elements/base.py`) and are resolved server-side from the element's name.
 * A contract sentence copied into the editor would be a second copy of a
 * statement about backend behaviour, and a prompt that exists twice is a prompt
 * that will drift -- which is exactly what happened to the file-selector
 * sentence, which existed three times.
 */
export interface ElementGeneration<S = any> {
  /**
   * Field holding the user's request. `'description'` means the node's own
   * description rather than a config key -- the ai node's request lives there.
   */
  promptField: string;
  /** Field the generated text is written into. */
  targetField: string;
  /**
   * Is the button offered for this particular subject? Omitted means always.
   * An input node selects files only in directory mode; that is a question
   * about one node, not about the element, which is why it is here and not in
   * the backend descriptor.
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
  // Seven editors drew the same five controls -- a prompt box, the 📎 example,
  // an optional language picker, the ✨ button and the body box -- and differed
  // only in their wording. The wording belongs to the element; the drawing
  // belongs to `AuthoredBodyEditor`, which is why these live here rather than
  // as props somebody has to remember to pass.
  promptLabel?: string;
  promptPlaceholder?: string;
  bodyLabel?: string;
  bodyPlaceholder?: string;
  /** Wording for the 📎 attachment, when "Example input" is not specific enough. */
  exampleLabel?: string;
  /** Render the body in a monospace box: true wherever the body is real code. */
  mono?: boolean;
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
 * When a sample from the last run was available the backend ran the function
 * before handing it over, so there is more to report than "done" -- and when it
 * still does not run, saying so now is kinder than letting the next ▶ Run say it.
 */
function probeMessage(probe: CodeProbeReport | undefined, fallback: string): string {
  switch (probe?.status) {
    case 'ok':
      return '✅ Generated and verified against the last run\'s data.';
    case 'repaired':
      return '✅ Generated. The first attempt failed on your data; this one runs.';
    case 'failed':
      return `⚠️ Generated, but it does not run yet: ${probe.error || `missing ${probe.missing_outputs.join(', ')}`}`;
    default:
      return fallback;
  }
}

/** The JSON type of a value, the way a contract names it. */
function shapeOf(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `${value.length ? shapeOf(value[0]) : 'unknown'}[]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as object).slice(0, 8);
    return `{ ${keys.map((k) => `${k}: ${shapeOf((value as Record<string, unknown>)[k])}`).join(', ')} }`;
  }
  return typeof value;
}

/**
 * What a generated body returned, as the contract the next node is written to.
 *
 * Structure first -- each key and the type of what it held -- because that is
 * what a generator downstream needs to write against; the example after it is
 * for the reader. Measured, not promised: the verify pass ran the code.
 */
export function measuredContract(probe: CodeProbeReport | undefined): string {
  const outputs = probe?.outputs;
  if (outputs && Object.keys(outputs).length) {
    const shape = Object.entries(outputs).map(([key, value]) => `${key}: ${shapeOf(value)}`).join(', ');
    return `Returns { ${shape} }. Observed when generated: ${probe!.output_preview}`;
  }
  const preview = probe?.output_preview?.trim();
  return preview ? `Returns, as observed when this was generated: ${preview}` : '';
}

export interface GenerationRequest<S> {
  /** NodeType or GuiWidgetKind -- the server resolves the rest from it. */
  element: string;
  generation: ElementGeneration<S>;
  subject: S;
  fields: FieldAccess;
  /** The element's real ports, for a snippet that is wired as the node is. */
  ports?: { inputs: string[]; outputs: string[] };
  /** The one example-input path this element carries. */
  exampleFile?: string;
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
  /**
   * Write down what the generated body actually returned.
   *
   * The backend already ran it against real data before handing it over, so the
   * probe's preview is a measurement rather than a promise — and it is exactly
   * what the *next* node has to be generated against. Only for a node: a block
   * inside a page has no output contract of its own, and only when the node
   * states none, because a contract somebody wrote by hand is not something a
   * generation gets to overwrite.
   */
  recordMeasuredOutput?: boolean;
}

/**
 * Turn an element's declaration into the options `useGenerate().run` takes.
 *
 * Both shells call exactly this, so a node and a widget generate through one
 * code path -- as they already execute, author files and declare ports through
 * one.
 */
export function buildGeneration<S>(request: GenerationRequest<S>): GenerateOptions<GenerationResult> {
  const { generation: spec, subject, fields } = request;
  const prompt = fields.get(spec.promptField).trim();
  const context = [spec.context?.(subject), request.graphContext].filter(Boolean).join('\n\n');

  return {
    guard: () => (prompt ? undefined : (spec.guard ?? 'Please add a prompt first.')),
    pending: 'Generating…',
    success: (result) => probeMessage(result.probe, spec.success ?? '✅ Generated!'),
    failure: 'Generation failed',
    run: () => generate({
      element: request.element,
      description: prompt,
      context,
      context_file: request.exampleFile || undefined,
      inputs: request.ports?.inputs,
      outputs: request.ports?.outputs,
      sample_inputs: request.sampleInputs,
      input_sources: request.inputSources,
      ...genAI(),
    }),
    apply: (result) => {
      fields.set(spec.targetField, result.result);

      if (!request.recordMeasuredOutput) return;
      if (fields.get('output_format_prompt').trim()) return;
      const contract = measuredContract(result.probe);
      if (!contract) return;
      fields.set('output_format_prompt', contract);
      fields.set('output_format', 'custom');
    },
  };
}
