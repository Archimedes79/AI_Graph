// How an AI writes an element's body, declared by the element.
//
// The ✨ buttons were once five hand-written call sites in the editor, and an
// element one of them forgot had a body and no way to fill it. An element
// declares this instead, so a shell renders one button per element and knows
// nothing about which element it is.
//
// A body is one of three things, and each is written with a standard prompt
// of its own (`authoring/prompts.ts`): code that runs, the instructions a
// model is given, or the data a node holds. A node that also has definitions
// -- what one call is handed, and what it returns (`NodeRunner.definitions`)
// -- has them written by the same ✨, first, where they are missing.

import type { LogicFields } from './logic.ts';

/** What the body is, and so which standard prompt writes it. */
export type GenerationKind = 'code' | 'prompt' | 'data';

/** One element's answer to "how does an AI write this?". */
export interface Generation {
  kind: GenerationKind;
  /** Where the body is kept: the same constant the element's `logic()` is built from, where it has one. */
  fields: LogicFields;
}
