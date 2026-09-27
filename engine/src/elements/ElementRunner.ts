// What an element does when it runs.
//
// One class per node type and per widget kind, holding everything that kind
// needs to behave: what it stores, which ports it contributes, and what it
// does when the graph runs. Two branches share this base -- `NodeRunner` for a
// node, `WidgetRunner` for a block on a page -- and what they share is little:
// settings of their own, and whether a failure is caught. The rest is each
// branch's: a node has a body someone writes and files of its own, a block
// shows or hands on what it holds and writes nothing.
//
// **Why `Runner` and not `Element`.** An element has two halves, and the names
// say which is which rather than leaving it to the folder. This is the half the
// application is *made of*: it lives in the engine, it runs the graph, and it
// would still do so with no browser anywhere. Its counterpart is
// `editor/src/elements/ElementGuiBuilder.ts` -- the half that exists only so a
// person can build the thing. Each concrete class is named the same way:
// `AiNodeRunner` beside `AiNodeGuiBuilder`, `SelectWidgetRunner` beside
// `SelectWidgetGuiBuilder`. `editor/src/elements/symmetry.test.ts` holds the
// two lists to each other, class for class.
//
// **The element owns its config.** `config(subject)` reads the stored record
// and returns this element's own settings, with defaults applied. Nothing else
// reads another element's fields.
//
// **Services arrive as a `Runtime`** (`Runtime.ts`), never as an import.
//
// **Its browser half is a mirror, not a subclass.** How an element looks and
// is edited lives at the same relative path under `editor/src/elements/`
// (`<Kind>View.tsx`, `<Kind>Panel.tsx`, `<Kind>GuiBuilder.ts`); nothing here
// imports it, which is what keeps the editor out of a deployed bundle.

import type { RawConfig } from '../graph.ts';

/**
 * What a node and a block share: settings of their own, and whether a failure
 * becomes an `error` output.
 *
 * `S` is what this element is attached to — a node or a block — and `C` is the
 * settings it owns.
 */
export abstract class ElementRunner<S extends { id: string; config: RawConfig }, C> {
  // ── What it is ────────────────────────────────────────────────────────────
  // Asked whenever the graph is read: by a run, by the editor, by a project folder.

  /** This element's settings, defaulted. The only reader of `S.config`. */
  abstract config(subject: S): C;

  // ── Run time ──────────────────────────────────────────────────────────────
  // What a run asks. A deployed tool needs nothing below this block.

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

  // ── Build time ────────────────────────────────────────────────────────────
  // Nothing both branches share: what only building asks is a node's
  // (`NodeRunner`) or a block's (`WidgetRunner`). Nothing a run calls may reach
  // it (`elements/times.test.ts` holds that line).
}
