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

import type { GraphNode, Port, RawConfig, WidgetKind, NodeType } from './graph.js';

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
  run(
    body: string,
    language: string,
    inputs: Record<string, unknown>,
    requirements?: string[],
  ): Promise<Record<string, unknown>>;
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

/** A body the user writes at length, optionally kept in a file beside the graph. */
export interface AuthoredFile {
  /** Where the body is stored inside this element's config. */
  bodyField: string;
  /** Where the chosen file name is stored. */
  nameField: string;
  extension: string;
  /** For the editor's sentence: "keep <what> in a file". */
  what: string;
}

/** What a deploy bundle must carry for this element to run elsewhere. */
export interface DeployNeeds {
  /** Python/npm packages the element's own body declared. */
  requirements: string[];
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

  /** The body this element lets a user write, if it lets them write one. */
  authoredFile(_subject: S): AuthoredFile | undefined {
    return undefined;
  }

  /** A failing snippet: fatal by default, cosmetic where nothing downstream depends on it. */
  readonly snippetFailure: SnippetFailure = 'fatal';

  deployNeeds(_subject: S): DeployNeeds {
    return { requirements: [], needsInterface: false };
  }

  /**
   * Run this element's authored body over *inputs*.
   *
   * An absent or empty body passes the inputs through. That is the sane
   * default and used to mean three different things in three elements: one
   * called the sandbox anyway and failed with a NameError out of a subprocess,
   * one guarded first, one passed through. An element for which an empty body
   * is a real error says so by overriding.
   */
  async runSnippet(
    subject: S,
    inputs: Record<string, unknown>,
    runtime: Runtime,
    override?: string,
  ): Promise<Record<string, unknown>> {
    const spec = this.authoredFile(subject);
    const body = override ?? (spec ? String(subject.config[spec.bodyField] ?? '') : '');
    if (!body.trim()) return inputs;

    const language = String(subject.config.language ?? 'python');
    const requirements = (subject.config.requirements as string[] | undefined) ?? [];
    try {
      return await runtime.code.run(body, language, inputs, requirements);
    } catch (error) {
      if (this.snippetFailure !== 'cosmetic') throw error;
      const reason = error instanceof Error ? error.message : String(error);
      return { value: `⚠ ${subject.id}: transform failed:\n${reason}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export abstract class NodeElement<C = unknown> extends Element<GraphNode, C> {
  abstract readonly nodeType: NodeType;

  /**
   * This node keeps its value between runs, so an edge into it can close a
   * cycle: the executor leaves such an edge out of the ordering and settles the
   * fresh value afterwards, for the *next* round.
   */
  readonly isMemory: boolean = false;

  /** This node carries the graph's interface. */
  readonly hasInterface: boolean = false;

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
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

/** A block on the page. Its settings live in `config`, owned by its element. */
export interface Widget {
  id: string;
  kind: WidgetKind;
  label: string;
  w: number;
  h: number;
  tone: string;
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
        multi: false,
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
