// What an element is.
//
// One class per node type and per widget kind, holding everything that kind
// needs to behave: what it stores, which ports it contributes, what it does
// when the graph runs, and how an AI writes its body. Two branches share this
// base -- `NodeElement` for a node, `WidgetElement` for a widget on a
// page -- because a node and a widget differ in what they are attached to and
// in nothing else.
//
// **The element owns its config.** `config(subject)` reads the stored record
// and returns this element's own settings, with defaults applied and old field
// names accepted. Nothing else reads another element's fields.
//
// **Services arrive as a `Runtime`** (`Runtime.ts`), never as an import.
//
// **Its browser half is a mirror, not a subclass.** How an element looks and
// is edited lives at the same relative path under `editor/src/elements/`
// (`<Kind>View.tsx`, `<Kind>Panel.tsx`, `<Kind>Ui.ts`); nothing here imports it,
// which is what keeps the editor out of a deployed bundle.

import type { RawConfig } from '../graph.ts';
import type { Logic } from '../authoring/logic.ts';
import type { Generation } from '../authoring/generation.ts';
import type { Runtime } from './Runtime.ts';

/** What a deploy bundle must carry for this element to run elsewhere. */
export interface DeployNeeds {
  /** The bundle needs the interface: a page, not just a CLI. */
  needsInterface: boolean;
  /**
   * It calls a model, so whoever receives the bundle needs a provider set up.
   *
   * Asked of the element rather than looked for by node type. A node that
   * holds a graph answers for itself; what is *inside* it is followed by
   * `bundleNeeds`, which walks the graphs.
   */
  asksAi: boolean;
}

/**
 * One piece of an element's writing, as a project folder keeps it: a file of
 * its own in the element's folder instead of a string inside `graph.json`.
 */
export interface TextFile {
  /** The config key it is stored under. */
  field: string;
  /** Its name in the element's folder. */
  file: string;
  /** A value kept as JSON rather than as text. */
  json?: boolean;
  /**
   * What the file says while nobody has written anything of their own. Written
   * out all the same, so the folder shows what the element does.
   */
  standard?: string;
  /** Every `standard` there has been: a file still holding one is brought up to date on save. */
  earlier?: readonly string[];
}

/**
 * What runs when an element runs, said for whoever reads its folder or its
 * panel: a node's `interface.json` carries it, and the editor shows it.
 */
export interface WhatRuns {
  /**
   * `engine`: this class's `execute`, in the process that holds the graph.
   * `body`: a file in the element's own folder, run sandboxed (`elements/body.ts`).
   */
  by: 'engine' | 'body';
  /** The source file and method, or the body's file name in the element's folder. */
  where: string;
  /** One sentence: what it does with what arrives. */
  does: string;
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
 * in nothing else, which is why they share this base.
 */
export abstract class Element<S extends { id: string; config: RawConfig }, C> {
  // ── What it is ────────────────────────────────────────────────────────────
  // Asked whenever the graph is read: by a run, by the editor, by a project folder.

  /** This element's settings, defaulted and migrated. The only reader of `S.config`. */
  abstract config(subject: S): C;

  /**
   * What this element keeps in files of its own when its graph is a project
   * folder. Everything else it stores stays in `graph.json`.
   *
   * Fixed names rather than ones made from a label: a folder holding
   * `code.js`, `task.md` and `output.schema.json` says what each file is
   * before it is opened, and renaming a node renames nothing on disk.
   */
  texts(_subject: S): readonly TextFile[] {
    return [];
  }

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

  // ── Run time ──────────────────────────────────────────────────────────────
  // What a run asks. A deployed tool needs nothing below this block.

  /** A failing snippet: fatal by default, cosmetic where nothing downstream depends on it. */
  readonly snippetFailure: SnippetFailure = 'fatal';

  /**
   * Whether a failure here becomes an `error` output instead of ending the run.
   *
   * Off unless someone asks for it: a graph that has not been given somewhere
   * to put a failure should stop at one, loudly. Carried out by the executor,
   * one level up, so every element gets the same behaviour without a copy of
   * it -- the same division as batching and reading file inputs.
   */
  catchesErrors(subject: S): boolean {
    return subject.config.catch_errors === true;
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
      return await logic.run(inputs, runtime);
    } catch (error) {
      if (this.snippetFailure !== 'cosmetic') throw error;
      const reason = error instanceof Error ? error.message : String(error);
      return { value: `⚠ ${subject.id}: transform failed:
${reason}` };
    }
  }

  // ── Build time ────────────────────────────────────────────────────────────
  // What only building asks: the editor, `check`, a bundle being made. It travels
  // with the class -- one class per kind is worth more than a smaller tool -- but
  // nothing a run calls may reach it (`elements/times.test.ts` holds that line).

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

  /**
   * What a bundle must carry for this element to run somewhere else.
   *
   * Every body may ask a model (`body.ts`), so every body is looked at, and any
   * mention counts -- `node.llm(`, `{ llm }`, `const ask = node.llm`: a README
   * that explains the model to someone who turns out not to need it costs less
   * than a tool that stops at its first question.
   */
  deployNeeds(subject: S): DeployNeeds {
    const logic = this.logic(subject);
    return { needsInterface: false, asksAi: logic?.kind === 'code' && /\bllm\b/.test(logic.body) };
  }
}
