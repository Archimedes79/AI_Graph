// The session as a page sees it: what the graph's values hold now, what its
// outputs showed, the round going or gone -- as the server tells it, by name.
//
// One for every page that shows a graph in use -- the delivered tool, the
// editor's App and Page tabs -- fed by the server's stream
// (`GET /api/runtime/stream`): the session on connect and after every change,
// each round as it starts, goes and ends, whoever started it -- this page,
// another tab, the clock.
//
// What a person set on the page and has not sent yet is kept beside it, as
// edits. A round takes them along, and they are let go of once that round has
// run to its end and the session keeps them; a round that was stopped, or
// could not start, leaves them where they were -- the message still in hand.

import { create } from 'zustand';
import { pathFor } from '@engine/host/api.ts';
import { call, type Requirement, type RoundSnapshot, type SessionView } from './client';

export interface PageSession {
  /** The session as the server last told it; none before it has. */
  view: SessionView | null;
  /** The round going now, or the last one -- told as it goes. */
  round: RoundSnapshot | null;
  /** What was set here and not yet kept, by name. */
  edits: Record<string, unknown>;
  /** What each round in flight was sent, by its id: let go of when it ends. */
  sent: Record<string, Record<string, unknown>>;
}

export const useSession = create<PageSession>(() => ({ view: null, round: null, edits: {}, sent: {} }));

/** Rounds that ended before this page heard what it had sent them: a quick one beats its own answer. */
const endedEarly = new Map<string, boolean>();
/**
 * How many of them are remembered. Every round this page did not start ends
 * "early" too -- the clock's, another tab's -- and only the last few can still
 * be one whose start is on its way back here.
 */
const ENDED_EARLY_KEPT = 16;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Let go of what *sent* gave, now that its round ran to its end: unless it was set again since. */
function kept(edits: Record<string, unknown>, sent: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(edits).filter(([name, value]) => !(name in sent) || !same(sent[name], value)));
}

function sessionTold(view: SessionView): void {
  useSession.setState((state) => ({
    view,
    round: view.round ?? state.round,
    // Another session -- another document, or a server started anew: what was
    // set for the one before is not this one's.
    ...(state.view && state.view.session !== view.session ? { edits: {}, sent: {} } : {}),
  }));
}

function roundTold(round: RoundSnapshot): void {
  useSession.setState((state) => {
    if (!round.done) return { round };
    const ranToItsEnd = !round.cancelled && round.result !== null;
    const sent = state.sent[round.round_id];
    if (!sent) {
      endedEarly.set(round.round_id, ranToItsEnd);
      if (endedEarly.size > ENDED_EARLY_KEPT) endedEarly.delete(endedEarly.keys().next().value!);
      return { round };
    }
    const { [round.round_id]: _ended, ...going } = state.sent;
    return { round, sent: going, edits: ranToItsEnd ? kept(state.edits, sent) : state.edits };
  });
}

/** The stream listened to now. */
let listening: EventSource | null = null;

/**
 * Listen to the session the server holds now, until the returned function is
 * called. Listening again -- the editor handing over another document --
 * replaces what was listened to before.
 */
export function watchSession(): () => void {
  listening?.close();
  const stream = new EventSource(pathFor('stream').path);
  stream.addEventListener('session', (event) => sessionTold(JSON.parse((event as MessageEvent<string>).data) as SessionView));
  stream.addEventListener('round', (event) => roundTold(JSON.parse((event as MessageEvent<string>).data) as RoundSnapshot));
  listening = stream;
  return () => {
    stream.close();
    if (listening === stream) listening = null;
  };
}

/** Set *name* here: shown at once, and sent with the next round. */
export function setEdit(name: string, value: unknown): void {
  useSession.setState((state) => ({ edits: { ...state.edits, [name]: value } }));
}

/** What *name* holds as this page shows it: what was set here, else what the session holds, else *design*. */
export function heldValue(state: PageSession, name: string, design: unknown): unknown {
  if (name in state.edits) return state.edits[name];
  if (state.view && name in state.view.values) return state.view.values[name];
  return design;
}

/** Whether a round is going: the page's, another tab's, the clock's. */
export const roundGoing = (state: PageSession): boolean => !!state.round && !state.round.done;

/** What a round for *event* still needs before it runs, given *values*: the "before running" questions. */
export function requirementsFor(event: string | null, values: Record<string, unknown>): Promise<Requirement[]> {
  return call('requirements', { event, values });
}

/** Start a round for *event* -- the whole graph for none -- given *values* by name. */
export async function startRound(event: string | null, values: Record<string, unknown>): Promise<void> {
  const { round_id: id } = await call('startRound', { event, values });
  const early = endedEarly.get(id);
  endedEarly.delete(id);
  useSession.setState((state) => (early === undefined
    ? { sent: { ...state.sent, [id]: values } }
    : { edits: early ? kept(state.edits, values) : state.edits }));
}

/** Stop the round going, whoever started it. */
export async function stopRound(): Promise<void> {
  const { round } = useSession.getState();
  if (round && !round.done) await call('stopRound', { id: round.round_id });
}
