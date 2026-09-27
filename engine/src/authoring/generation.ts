// How an AI writes an element's body, declared by the element.
//
// The ✨ Generate buttons were once five hand-written call sites in the editor,
// and an element one of them forgot had a body and no way to fill it. An
// element declares this instead, so a shell renders one button per element and
// knows nothing about which element it is.
//
// It lives beside `Logic` on purpose. A logic says where the body is kept and
// who runs it; this says how the body gets written in the first place, and both
// name the *same* config keys — passed in as one `LogicFields` constant per
// element, so the two can never drift into naming different fields.

import type { LogicFields } from './logic.ts';

/**
 * Which generator writes the body, and so which prompt it is written with:
 * code that runs, or a system prompt a model is sent.
 */
export type GenerationKind = 'code' | 'prompt';

/** One element's answer to "how does an AI write this?". */
export interface Generation {
  kind: GenerationKind;
  /** The same constant the element's `logic()` is built from. */
  fields: LogicFields;
  /** Shown when the request field is still empty. */
  guard: string;
  /** Shown when the generated text arrives. */
  success: string;
}
