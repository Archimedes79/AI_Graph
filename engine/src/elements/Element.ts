// What an element is.
//
// One class per node type and per widget kind, holding everything that kind
// needs to behave: what it stores, which ports it contributes, what it does
// when the graph runs, and how an AI writes its body. Two branches share this
// base -- `GraphNodeElement` for a node, `WidgetElement` for a widget on a
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
// (`<Kind>View.tsx`, `<Kind>Panel.tsx`, `<Kind>.ui.ts`); nothing here imports it,
// which is what keeps the editor out of a deployed bundle.

import type { RawConfig } from '../graph.ts';
import type { Logic } from '../authoring/logic.ts';
import type { Generation } from '../authoring/generation.ts';
import type { Runtime } from './Runtime.ts';

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
 * in nothing else, which is why they share this base.
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
