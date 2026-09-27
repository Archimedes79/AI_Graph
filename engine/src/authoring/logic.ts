// What an element does, as an object rather than as three field names.
//
// Every node that does anything authored does it the same way: someone writes a
// request, an AI turns it into a body, and the body is what runs. A code node
// and an AI node are instances of that one sentence, and they differ only in
// which config keys hold the two halves — `code`/`code_prompt` here,
// `system_prompt`/the node's own description there.
//
// That difference was expressed as strings: an element returned the *names* of
// its fields and the caller reached into an untyped bag to find them, and the
// same idea was declared more than once, with a different field list each time.
//
// So the body becomes a thing. An element hands out a `Logic`; a caller runs
// it. Nobody names a config key, and nobody needs the element to run the body
// it was given.

import type { Runtime } from '../elements/Runtime.ts';
import { runBody, type BodyGiven } from '../elements/body.ts';

/**
 * What the body *is*, which decides who executes it.
 *
 * `code` runs in the sandbox. `prompt` is sent to a model as the system half of
 * a request.
 */
export type LogicKind = 'code' | 'prompt';

/** Where a logic keeps its two halves inside an element's stored config. */
export interface LogicFields {
  /** The config key holding the body. */
  body: string;
  /** The config key holding the request that produced it. */
  prompt: string;
  /** The request lives on the node itself (its description), not in config. */
  promptOnSubject?: boolean;
}

/**
 * One element's authored half: the request, the body, and how to run it.
 *
 * Constructed by the element from its own config, so the field names above
 * appear once — in the element that owns them — instead of travelling to every
 * caller that wants the body.
 */
export class Logic {
  /** What the body is, and so who executes it. */
  readonly kind: LogicKind;
  /** The natural-language request that produced `body`. */
  readonly prompt: string;
  /** What runs, or what is sent. Empty means "not written yet". */
  readonly body: string;
  /** Which config keys these came from, for the editor and the file layer. */
  readonly fields: LogicFields;

  // Fields declared and assigned rather than written as constructor parameter
  // properties: the engine has to survive Node's type stripping, and a
  // parameter property is one of the few TypeScript spellings that emits code
  // rather than only removing types. `strippable.test.ts` holds every file here
  // to that.
  constructor(kind: LogicKind, prompt: string, body: string, fields: LogicFields) {
    this.kind = kind;
    this.prompt = prompt;
    this.body = body;
    this.fields = fields;
  }

  /**
   * The extension a file holding this body should have.
   *
   * Derived rather than declared: real code gets `.js` and an editor's language
   * support with it, prose gets `.md` because prose in a `.js` is a syntax
   * error. This used to be a field every element filled in, which is how one of
   * them came to say `.py` long after the last Python body was gone.
   */
  get extension(): string {
    return this.kind === 'code' ? '.js' : '.md';
  }

  /** Whether anything was actually written. */
  get isEmpty(): boolean {
    return !this.body.trim();
  }

  /**
   * Run the body over *inputs*.
   *
   * Only meaningful for `code`; a prompt is sent by the element that owns the
   * model call. An empty body passes the inputs
   * through — the sane default, which used to mean three different things in
   * three elements: one called the sandbox anyway and failed with a reference
   * error out of a subprocess, one guarded first, one passed through.
   *
   * No failure policy here: what a failure costs is the executor's business
   * (`catch_errors`), the same for every element.
   */
  async run(inputs: Record<string, unknown>, runtime: Runtime, given?: BodyGiven): Promise<Record<string, unknown>> {
    if (this.isEmpty) return inputs;
    return runBody(this.body, inputs, runtime, given);
  }
}

/** Read a logic straight off a subject's config, given where its halves live. */
export function logicFrom(
  subject: { config: Record<string, unknown>; description?: string },
  kind: LogicKind,
  fields: LogicFields,
): Logic {
  const prompt = fields.promptOnSubject
    ? String(subject.description ?? '')
    : String(subject.config[fields.prompt] ?? '');
  return new Logic(
    kind,
    prompt,
    String(subject.config[fields.body] ?? ''),
    fields,
  );
}
