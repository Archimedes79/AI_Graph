// The clock of a tool that runs by itself: what its trigger nodes start, one
// round after another.
//
// Kept by the server's session (`host/session.ts`) -- for the tool it serves,
// and for the application the editor's ▶ Run starts -- so there is one clock,
// and it goes on whether or not a page is open. There were two copies, the
// server's and the browser's, and they came to disagree about when a round is
// due: one armed an on-start trigger's clock when the tool started, the other
// after its first round.
//
// What starting runs is `startEvents`'s to say: each trigger node set to fire
// at start fires first. Each one with an interval then keeps its own time,
// counted from the end of its last round to the start of the next -- the rule
// `--every` follows on the command line -- so a round slower than its interval
// is followed by the next rather than overtaken by it. Rounds share one queue
// and never overlap.
//
// A trigger is looked up again each time it is due, in the graph as it is
// then: deleted since, its clock stops rather than start a round for a node
// that is not there; its interval changed, the new one counts from then on.

import type { Graph } from '../graph.ts';
import type { Runners } from '../elements/NodeRunner.ts';
import { after, graphTriggers, parseInterval, startEvents, type GraphTrigger, type Trigger } from './triggers.ts';

export interface Clock {
  /** Whether it runs anything by itself: a trigger fires at start, or keeps time. */
  readonly runsByItself: boolean;
  /** Whether a trigger keeps time: a tool with one has something left to happen once it has started. */
  readonly ticks: boolean;
  /** Why an interval could not be read, while one cannot: that trigger keeps no time. */
  problem(): string | null;
  /** When the next round is due, or null while none is. */
  nextAt(): number | null;
  /** Settles once the rounds starting the tool began have run. */
  readonly started: Promise<void>;
  /** No round starts afterwards; settles once the round in flight has ended. */
  stop(): Promise<void>;
}

interface Hand {
  event: Trigger;
  ms: number;
  next_at: number | null;
  cancel?: () => void;
}

/** Whether *trigger* keeps time: it has an interval, and one that can be read. */
export function keepsTime(trigger: GraphTrigger): boolean {
  try {
    return !!trigger.every && parseInterval(trigger.every) > 0;
  } catch {
    return false;
  }
}

const same = (a: Trigger, b: Trigger): boolean => a.node_id === b.node_id && (a.port_id ?? null) === (b.port_id ?? null);

/**
 * Start the clock of *graph* -- asked again each time a trigger is due -- and
 * hand each round to *round*, one at a time. A round's failure is the host's
 * to report; a round that throws does not stop the clock.
 */
export function startClock(graph: () => Graph, elements: Runners, round: (event: Trigger) => Promise<void>): Clock {
  let problem: string | null = null;
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  /** Its interval in milliseconds, 0 for none -- or for one nobody can read, which is said once. */
  const interval = (trigger: GraphTrigger): number => {
    if (!trigger.every) return 0;
    try {
      return parseInterval(trigger.every) * 1000;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
      return 0;
    }
  };

  const hands: Hand[] = graphTriggers(graph()).map((trigger) => ({ event: trigger.event, ms: interval(trigger), next_at: null }));

  const wind = (hand: Hand): void => {
    if (stopped || hand.ms <= 0) return;
    hand.next_at = Date.now() + hand.ms;
    // Whoever holds the clock is what keeps a process alive, not a round due.
    hand.cancel = after(hand.ms, () => begin(hand), false);
  };

  const tick = async (hand: Hand): Promise<void> => {
    hand.next_at = null;
    if (stopped) return;
    const now = graphTriggers(graph()).find((trigger) => same(trigger.event, hand.event));
    if (!now) return;
    hand.ms = interval(now);
    try {
      await round(hand.event);
    } catch {
      // The host says what went wrong with a round; the next one may be fine.
    }
    wind(hand);
  };

  const begin = (hand: Hand): void => { inFlight = inFlight.then(() => tick(hand)); };

  const starting = startEvents(graph(), elements);
  const firesAtStart = (hand: Hand): boolean => starting.some((event) => event !== null && same(event, hand.event));
  for (const hand of hands) {
    if (firesAtStart(hand)) begin(hand);
    else wind(hand);
  }
  const started = inFlight;

  return {
    runsByItself: hands.some((hand) => hand.ms > 0 || firesAtStart(hand)),
    ticks: hands.some((hand) => hand.ms > 0),
    problem: () => problem,
    nextAt: () => {
      const due = hands.map((hand) => hand.next_at).filter((at): at is number => at !== null);
      return due.length ? Math.min(...due) : null;
    },
    started,
    stop: () => {
      stopped = true;
      for (const hand of hands) {
        hand.cancel?.();
        hand.next_at = null;
      }
      return inFlight;
    },
  };
}
