// What ✨ Generate is told about a selector -- the code that keeps some of a
// folder's files -- in the editor's words, once for its two levels.
//
// An input node in directory mode and a folder picker on a page are one
// behaviour at two levels (`fileSelection.ts`): the engine hands both the same
// `SELECTOR_GENERATION`, and `SelectorSteps` draws both. The words over it --
// what the task box and the code box are called, and when there is a selector
// to write at all -- were written out in each builder, one of them reading
// "every file" by hand where the other asked the engine.

import type { Generation } from '@engine/authoring/generation.ts';
import { fromEngine, type ElementGeneration } from './generation';

interface Own<S> {
  /** It lists a folder: in one file's mode there is nothing to select from. */
  isFolder: (subject: S) => boolean;
  /** A run takes every file and runs no selector: the engine element's answer. */
  selectsAll: (subject: S) => boolean;
  /** Its listing, the way a run makes it at its level. */
  fetchSample: NonNullable<ElementGeneration<S>['fetchSample']>;
  bodyHeight: number;
  context?: ElementGeneration<S>['context'];
}

/** The selector's generation, from the engine's declaration (*generation*) and what differs at each level. */
export function selectorGeneration<S>(generation: Generation | undefined, own: Own<S>): ElementGeneration<S> {
  return {
    ...fromEngine(generation),
    // Only a folder is selected from, and only when not every file is taken.
    available: (subject) => own.isFolder(subject) && !own.selectsAll(subject),
    promptLabel: 'Which files to keep',
    promptPlaceholder: 'e.g. the Markdown files that document an API',
    bodyLabel: 'Code — run(inputs) receives {"files"} and must return {"files"}',
    bodyHeight: own.bodyHeight,
    ...(own.context ? { context: own.context } : {}),
    fetchSample: own.fetchSample,
  };
}
