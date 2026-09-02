// What an element is.
//
// One class per node type and per widget kind, holding everything that kind
// needs to behave: what it stores, which ports it contributes, and what it does
// when the graph runs. It replaces two half-elements that had to agree across a
// language boundary — a Python class with the behaviour and a TypeScript object
// with the editing, plus a test asserting the two said the same thing.
//
// Three deliberate shapes:
//
// **The element owns its config.** `config(subject)` reads the stored record
// and returns this element's own settings, with defaults applied and old field
// names accepted. Nothing else may read another element's fields, and now
// nothing else *can* — the type says so, where a `config_fields` list and a
// source-parsing test used to say so.
//
// **Services arrive as a `Runtime`, never as an import.** An element that
// imported the filesystem could only ever run where a filesystem exists, and
// could only be tested by monkey-patching a module. Passed in, the same element
// runs on a server, in a browser tab and inside a test with three fakes.
//
// **Editing lives in a subclass, in another file.** `element.ts` is what a
// deployed tool runs; the editor's class extends it and adds the config panel,
// the palette entry and the ✨ descriptor. The inheritance points from editor to
// runtime and never the other way, which is what keeps the editor out of a
// bundle: the runtime never imports the subclass.

import type { GraphNode, Port, RawConfig, WidgetKind, NodeType } from './graph.ts';
import type { RuntimeRequirement } from './runtimeValues.ts';
import type { Logic } from './logic.ts';
import type { Generation } from './generation.ts';

// ---------------------------------------------------------------------------
// The world an element is allowed to touch
// ---------------------------------------------------------------------------

/** Reading and writing files, wherever this engine happens to run. */
export interface FileService {
  read(path: string, mode?: 'text' | 'binary'): Promise<string>;
  write(path: string, content: string, mode?: 'text' | 'binary'): Promise<void>;
  list(path: string, options?: { recursive?: boolean; extensions?: string[] }): Promise<string[]>;
  resolve(path: string): string;
  exists(path: string): Promise<boolean>;
}

/** Running an authored body: `run(inputs) -> outputs`, both plain JSON. */
export interface CodeRunner {
  run(body: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** One completion from a model. */
export interface AiRequest {
  prompt: string;
  system?: string;
  provider?: string;
  model?: string;
  temperature?: number;
  images?: string[];
}

export interface AiService {
  complete(request: AiRequest): Promise<string>;
}

/** Progress, for a caller that wants to show it. Ignoring it is valid. */
export type ProgressEvent =
  | { type: 'node_start'; node_id: string }
  | { type: 'node_done'; node_id: string; status: string }
  | { type: 'batch'; node_id: string; done: number; total: number }
  | { type: 'activity'; node_id: string; message: string };

/** Everything an element may reach outside itself. */
export interface Runtime {
  files: FileService;
  code: CodeRunner;
  ai: AiService;
  report?(event: ProgressEvent): void;
}

// ---------------------------------------------------------------------------
// Declared facets
// ---------------------------------------------------------------------------

/** What a deploy bundle must carry for this element to run elsewhere. */
export interface DeployNeeds {
  /** The bundle needs the interface: a page, not just a CLI. */
  needsInterface: boolean;
}

/** What a failing authored snippet costs. */
export type SnippetFailure = 'fatal' | 'cosmetic';

// ---------------------------------------------------------------------------
// The base
// ---------------------------------------------------------------------------

/**
 * The half a node and a widget share.
 *
 * `S` is what this element is attached to — a node or a widget — and `C` is the
 * settings it owns. A node and a widget differ in what they are attached to and
 * in nothing else, which is why they were one base class in Python and are one
 * here.
 */
export abstract class Element<S extends { id: string; config: RawConfig }, C> {
  /** This element's settings, defaulted and migrated. The only reader of `S.config`. */
  abstract config(subject: S): C;

  /**
   * What this element does, if a person writes it: the request, the body, and
   * how to run it. `undefined` for an element that authors nothing -- an
   * output node has no text anyone writes at length.
   *
   * This replaced a declaration of *field names* that every caller then used to
   * reach into an untyped config. See `logic.ts` for what that cost.
   */
  logic(_subject: S): Logic | undefined {
    return undefined;
  }

  /**
   * How an AI writes this element's body, or undefined if none does.
   *
   * A property of the element, not of one subject: whether the button is
   * *offered* on a particular node — an input node selects files only in
   * directory mode — is a question about that node, and the editor asks it by
   * checking whether `logic()` answered.
   */
  generation(): Generation | undefined {
    return undefined;
  }

  /** A failing snippet: fatal by default, cosmetic where nothing downstream depends on it. */
  readonly snippetFailure: SnippetFailure = 'fatal';

  deployNeeds(_subject: S): DeployNeeds {
    return { needsInterface: false };
  }

  /**
   * Run this element's body, applying this element's failure policy.
   *
   * The running itself belongs to `Logic`; what is here is the one thing that
   * does not -- whether a broken body costs the whole node or only the block
   * that would have shown its result.
   */
  async runSnippet(
    subject: S,
    inputs: Record<string, unknown>,
    runtime: Runtime,
  ): Promise<Record<string, unknown>> {
    const logic = this.logic(subject);
    if (!logic) return inputs;
    try {
      return await logic.run(inputs, runtime.code);
    } catch (error) {
      if (this.snippetFailure !== 'cosmetic') throw error;
      const reason = error instanceof Error ? error.message : String(error);
      return { value: `⚠ ${subject.id}: transform failed:
${reason}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export abstract class NodeElement<C = unknown> extends Element<GraphNode, C> {
  abstract readonly nodeType: NodeType;

  /**
   * The ports this node has, *when they follow from its settings*.
   *
   * Two kinds of node, and the difference is worth naming. An input node's
   * ports follow from its mode — text has one output, a folder has `files` and
   * `count` — and a gui node's follow from its blocks. Nobody names those, and
   * a copy of them in the editor is a copy that can disagree with what the
   * element emits, which is exactly how an input node came to emit `output`
   * where its ports said `files`.
   *
   * A code, AI, data or output node is the other kind: a person names its ports
   * to match the code they wrote or the prompt they gave. `count_per_file` has
   * an input called `file`; `total` produces `bla_count` and `summary`. Those
   * are the graph's, not the element's, and returning null says so — the test
   * that checks declarations against real graphs is what made the distinction
   * visible in the first place.
   */
  derivedPorts(_node: GraphNode): { inputs: Port[]; outputs: Port[] } | null {
    return null;
  }

  /**
   * This node keeps its value between runs, so an edge into it can close a
   * cycle: the executor leaves such an edge out of the ordering and settles the
   * fresh value afterwards, for the *next* round.
   */
  readonly isMemory: boolean = false;

  /** This node carries the graph's interface. */
  readonly hasInterface: boolean = false;

  /**
   * Whether this node runs once for the whole list or once per item.
   *
   * A declaration, not an implementation: the fan-out itself belongs to the
   * executor, so "run this once per element" works the same for a code node and
   * an AI node and would work for a third kind without either being told. Both
   * used to carry their own copy of the loop, and the copies had begun to
   * differ in what an empty list meant.
   */
  batchMode(node: GraphNode): 'whole' | 'per_item' {
    return node.config.batch_mode === 'per_item' ? 'per_item' : 'whole';
  }

  /** How many items of a fan-out may be in flight at once. */
  batchConcurrency(node: GraphNode): number {
    return Number(node.config.batch_concurrency ?? 0) || 4;
  }

  /**
   * Whether a wired file path should arrive as the file's *content*.
   *
   * Declared, like batching, and carried out by the executor: a code node and
   * an AI node both want it and neither should own it. It lived inside the code
   * element for a while, which is why an AI node summarising a folder was
   * handed three filenames and dutifully summarised those.
   */
  readsFileInputs(node: GraphNode): boolean {
    return node.config.read_file_inputs === true;
  }

  /** Run once, for inputs already collected from the wires. */
  abstract execute(
    node: GraphNode,
    inputs: Record<string, unknown>,
    runtime: Runtime,
  ): Promise<Record<string, unknown>>;

  /**
   * Store a value that arrived on *portId* as this node's remembered state.
   * Only meaningful when `isMemory`; where it goes differs per element, which
   * is why the executor asks instead of branching on the node type.
   */
  settleMemory(_node: GraphNode, _portId: string, _value: unknown): void {}

  /**
   * What this node needs a person to supply before the graph can run.
   *
   * Asked of the element rather than looked up by node type, so a new element
   * that prompts says so in its own file — and the editor's dialog, a
   * terminal's prompts and a bundle's `--inputs` all read the same list.
   */
  runtimeRequirements(_node: GraphNode): RuntimeRequirement[] {
    return [];
  }

  /** Put one supplied value where this element keeps it. */
  applyRuntimeValue(_node: GraphNode, _widgetId: string | null, _value: string): void {}
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

/** A block on the page. Its settings live in `config`, owned by its element. */
/**
 * How a block sits on the page. Nothing an element ever reads to decide what
 * it does: the page draws from these, the engine only carries them.
 */
export interface WidgetPresentation {
  w: number;
  h: number;
  tone: string;
  /** Draw a frame, whatever the tone would do. Unset: the tone decides. */
  border?: boolean;
  /** A background colour of the person's own. Empty: the tone decides. */
  background?: string;
}

/**
 * A block: who it is, how it is drawn, and its element's settings.
 *
 * Flat on purpose. The three parts are named so the split is visible in the
 * type, but they are not nested: nesting would have to be undone by
 * `parseWidget` on every read anyway, since the stored file is flat, and two
 * copies of one fact are not a clearer design than one. What separates
 * presentation from settings is the type, and `PRESENTATION` in
 * `gui/element.ts` is checked against it.
 */
export interface Widget extends WidgetPresentation {
  id: string;
  kind: WidgetKind;
  label: string;
  /** The element's settings: everything the file holds that is not named above. */
  config: RawConfig;
}

export abstract class WidgetElement<C = unknown> extends Element<Widget, C> {
  abstract readonly widgetKind: WidgetKind;

  /** The ports this widget contributes to its gui node. */
  abstract ports(widget: Widget): { inputs: Port[]; outputs: Port[] };

  /**
   * Compute this widget's output ports: `{port_id: value}`, exactly as a node
   * does one level up. Never a bare value, not even with one port — a widget
   * that wants to report *why* it produced nothing needs a second port, and a
   * bare return has nowhere to put one.
   */
  abstract execute(
    widget: Widget,
    inputs: Record<string, unknown>,
    runtime: Runtime,
  ): Promise<Record<string, unknown>>;

  /** Last step before a display-only widget's value reaches the page. */
  async displayValue(_widget: Widget, value: unknown, _runtime: Runtime): Promise<unknown> {
    return value;
  }
}

/**
 * A widget that is part of the page rather than part of the graph: a heading, a
 * rule, a gap. No ports, and nothing to run.
 *
 * An interface built only from inputs and outputs cannot be laid out — there
 * was no way to write a title. These are what make a gui node a document rather
 * than a stack of labelled boxes.
 */
export abstract class StaticWidget<C = unknown> extends WidgetElement<C> {
  ports(): { inputs: Port[]; outputs: Port[] } {
    return { inputs: [], outputs: [] };
  }

  async execute(): Promise<Record<string, unknown>> {
    return {};
  }
}

/**
 * A widget that only shows something: one input port, no output.
 *
 * Nothing downstream depends on it, so a failure in its transform is cosmetic —
 * it becomes the displayed value instead of taking the whole node down, which
 * is what it used to do to every sibling widget.
 */
export abstract class DisplayWidget<C = unknown> extends WidgetElement<C> {
  override readonly snippetFailure: SnippetFailure = 'cosmetic';

  ports(widget: Widget): { inputs: Port[]; outputs: Port[] } {
    return {
      inputs: [{
        id: `${widget.id}_in`,
        name: widget.label || widget.id,
        kind: 'input',
        data_type: 'any',
        // Multi: several sources can feed one display, and the executor then
        // collects them as a list. A single-valued port would take the last
        // edge and drop the rest without saying so.
        multi: true,
        required: false,
        description: '',
      }],
      outputs: [],
    };
  }

  async execute(): Promise<Record<string, unknown>> {
    return {};
  }
}
