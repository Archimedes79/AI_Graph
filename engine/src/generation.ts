// How an AI writes an element's body, declared by the element.
//
// The ✨ Generate buttons were once five hand-written call sites in the editor,
// which is how `image_view` came to have a `code` field and no way to fill it:
// nobody added the sixth branch. An element declares this instead, so a shell
// renders one button per element and knows nothing about which element it is.
//
// It lives beside `Logic` on purpose. A logic says where the body is kept and
// who runs it; this says how the body gets written in the first place, and both
// name the *same* config keys — passed in as one `LogicFields` constant per
// element, so the two can never drift into naming different fields.

import type { LogicFields } from './logic.ts';

/**
 * Which generator writes the body, and so which prompt it is written with.
 *
 * `code` and `prompt` are the two bodies that run; `data_format` and
 * `output_format` are contracts written for *other* elements to be generated
 * against, which is a different prompt and a different result.
 */
export type GenerationKind = 'code' | 'prompt' | 'output_format' | 'data_format';

/** One element's answer to "how does an AI write this?". */
export interface Generation {
  kind: GenerationKind;
  /** The same constant the element's `logic()` is built from. */
  fields: LogicFields;
  /**
   * What THIS element does with the snippet, in the words the model is given.
   *
   * It lives next to the element that runs the snippet rather than in a shared
   * constants module, because it describes that element's behaviour and stops
   * being true the moment the behaviour changes.
   */
  contract?: string;
  /**
   * A sub-snippet's fixed port names. Omitted means "whatever this node is
   * actually wired as", which is what a code node wants — a transform inside a
   * block, by contrast, always receives `value` and returns `value`.
   */
  inputs?: string[];
  outputs?: string[];
  /** Shown when the request field is still empty. */
  guard: string;
  /** Shown when the generated text arrives. */
  success: string;
}

/**
 * The directory-mode file selector, declared once because it is implemented
 * once: an input node and a file-picker block run the identical
 * `run(inputs) -> {files}` contract, one as a node and one as a block inside a
 * page. The node/widget split is not a behavioural difference here, and two
 * copies of a prompt drift.
 */
export const SELECTOR_FIELDS: LogicFields = {
  body: 'selector_code', prompt: 'selector_prompt', file: 'code_file',
};

export const SELECTOR_GENERATION: Generation = {
  kind: 'code',
  fields: SELECTOR_FIELDS,
  contract:
    '`inputs["files"]` is the full list of rooted file paths found in the '
    + 'directory. Return only the selected paths as {"files": [...]}.',
  inputs: ['files'],
  outputs: ['files'],
  guard: 'Please describe which files to select first.',
  success: '✅ Selector generated!',
};
