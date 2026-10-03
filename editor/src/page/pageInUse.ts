import type { GuiWidget } from '@/graph';
import type { RoundSnapshot } from '@/api/client';
import { heldValue, roundGoing, type PageSession } from '@/api/session';
import type { PageModel } from './GuiPage';

/**
 * A page as it was designed, and the graph's names it is used by: what a host
 * knows of it before anything is used. A block is named by its id, so which
 * blocks start a round and which a round is given are the graph's events and
 * values -- the delivered tool is told them by the runtime API, the editor
 * asks the engine, and the page asks neither.
 */
export interface PageDesign {
  name: string;
  description: string;
  scheme: string;
  blocks: GuiWidget[];
  /** The graph's events, by name: the blocks that start a round. */
  events: string[];
  /** The graph's values, by name: the blocks a round is given what they hold. */
  values: string[];
  /** The graph's outputs, each with its label: what a page without blocks shows under it. */
  outputs: { name: string; label: string }[];
  /** The graph has no nodes at all. */
  empty?: boolean;
}

/** Why *round* failed, in its own words -- or nothing, for one that went, is going, or was stopped. */
export function roundError(round: RoundSnapshot | null): string {
  if (!round?.done || round.cancelled) return '';
  if (round.result) return round.result.status === 'error' ? round.result.error ?? '' : '';
  return round.error ?? '';
}

/**
 * The page in use: *design*, with what the session says of each block by its
 * name -- what it holds, what it shows -- and whether a round is going.
 */
export function pageInUse(design: PageDesign, session: PageSession): PageModel {
  const outputs = session.view?.outputs ?? {};
  const events = new Set(design.events);
  const values = new Set(design.values);
  return {
    name: design.name,
    description: design.description,
    scheme: design.scheme,
    blocks: design.blocks,
    valueOf: (block) => heldValue(session, block.id, block.value),
    shownOn: (block) => outputs[block.id],
    fires: (block) => events.has(block.id),
    takes: (block) => values.has(block.id),
    busy: roundGoing(session),
    error: roundError(session.round),
    outputs: design.outputs.map((output) => ({ ...output, value: outputs[output.name] })),
    empty: design.empty,
  };
}
