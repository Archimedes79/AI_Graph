// The graph in use, and what using it leaves behind.
//
// A graph is designed in the editor and kept as a folder; it is *used* by a
// page, a clock, a script. A session is one graph in use: the design as it
// was handed over -- by the editor, or loaded by a served tool -- and its
// state: what each node keeps between rounds (its slots), what each made last
// (the latch), what the rounds showed. The rules it keeps them by are "State"
// in docs/architecture.md; what they come to here:
//
// - Using a graph never changes its design. A round runs on a working copy,
//   the design with the slots put back into it and the values the round was
//   given put in by name, and what the round leaves is read back off the copy
//   afterwards (`NodeRunner.state`).
// - A round that ran to its end commits. One that was stopped, or could not
//   start, does not: what it began is nobody's to keep.
// - A slot is kept with the design value it started from, and is dropped --
//   said, never guessed -- once its node or block is gone, or its design
//   changed: the design wins.
// - All of it is written to `state.json` after every round that commits, read
//   back when the session opens, and deleted by a reset.
//
// Whoever watches a session (`watch`) is told every round as it starts, goes
// and ends, and the session again whenever what it keeps changed: what the
// stream a frontend reads is made of.
//
// One session per server, for now. It has an id all the same, kept in its
// file, so that more than one needs no change to what is said about each.

import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { mergeResults, type ExecutionResult, type Graph, type GraphNode } from '../graph.ts';
import { executeGraph, memoryFeedbackEdges } from '../execution/executor.ts';
import { triggeredNodes, type Trigger } from '../execution/triggers.ts';
import { applyValues, checkValues, outputsOf, valuesOf } from '../execution/graphInterface.ts';
import { runtimeRequirements, type RuntimeRequirement } from '../execution/runtimeValues.ts';
import { startClock, type Clock } from '../execution/clock.ts';
import { Latch, type Held } from '../execution/latch.ts';
import { LastOutputs } from '../execution/reuse.ts';
import { registry } from '../elements/registry.ts';
import type { ProgressEvent, Runtime } from '../elements/Runtime.ts';
import { stateFileOf } from '../project/folder.ts';
import { Refusal } from './http.ts';
import { nodeRuntime } from './node.ts';
import { Rounds, type RoundWork } from './rounds.ts';
import type { RoundSnapshot, SessionView } from './api.ts';

/** One slot a node keeps: what it holds now, and what its design held when that was kept. */
interface Slot {
  value: unknown;
  default: unknown;
}

/** Every node's slots that differ from its design, by node id and slot. */
type Slots = Map<string, Map<string, Slot>>;

/** What `state.json` holds: written after every round that commits, and never part of the project. */
interface StateFile {
  session: string;
  /** The graph's name, for whoever opens the file to see whose it is. */
  graph: string;
  saved_at: string;
  slots: Record<string, Record<string, Slot>>;
  held: Record<string, Held>;
  shown: ExecutionResult | null;
  rounds: number;
  finished_at: number | null;
}

/** What a watcher of a session is told: a round as it starts, goes and ends, or the session after a change. */
export type SessionEvent =
  | { type: 'round'; round: RoundSnapshot }
  | { type: 'session'; session: SessionView };

export interface SessionOptions {
  /** Where its state is kept (`stateFileOf`). None: a graph never saved, whose state lives as long as the session. */
  file?: string | null;
  /** The services a round runs with, told where to say how far it is. A test hands in fakes. */
  runtime?: (report: (event: ProgressEvent) => void) => Runtime;
}

/** How long a round is remembered to have run whole: as long as `Rounds` keeps it to look at. */
const FORGET_WHOLE_MS = 300_000;

/** How often a watcher is told how far a round is: a fan-out over 500 items reports 500 times. */
const PROGRESS_EVERY_MS = 100;

export class Session {
  readonly id: string;
  private design: Graph;
  private slots: Slots = new Map();
  private latch = new Latch();
  private reuse = new LastOutputs();
  private readonly rounds: Rounds;
  private shown: ExecutionResult | null = null;
  private count = 0;
  private finishedAt: number | null = null;
  private notes: string[] = [];
  private lastRound: string | null = null;
  /** The clock, while the application runs, and what stops the rounds it started. */
  private application: { clock: Clock; stop: AbortController } | null = null;
  private readonly file: string | null;
  private readonly runtime: (report: (event: ProgressEvent) => void) => Runtime;
  private readonly watchers = new Set<(event: SessionEvent) => void>();
  /** The rounds no event started: they ran the whole graph. */
  private readonly whole = new Set<string>();
  /** When each round's watchers were last told how far it is. */
  private readonly told = new Map<string, number>();
  /** The last write of the file, so the next waits for it: two at once would leave half of each. */
  private writing: Promise<void> = Promise.resolve();

  private constructor(id: string, design: Graph, options: SessionOptions) {
    this.id = id;
    this.design = design;
    this.file = options.file ?? null;
    this.runtime = options.runtime ?? ((report) => nodeRuntime({ report }));
    this.rounds = new Rounds((round, moment) => this.roundChanged(round, moment));
  }

  /** A session of *graph*, going on from what its file kept -- or a new one, when there is no file or it cannot be read. */
  static async open(graph: Graph, options: SessionOptions = {}): Promise<Session> {
    const file = options.file ?? null;
    let kept: StateFile | null = null;
    let unreadable = false;
    if (file) {
      try {
        kept = JSON.parse(await readFile(file, 'utf8')) as StateFile;
      } catch (error) {
        unreadable = (error as NodeJS.ErrnoException).code !== 'ENOENT';
      }
    }
    const session = new Session(typeof kept?.session === 'string' ? kept.session : randomUUID(), graph, options);
    if (kept) session.recall(kept);
    if (unreadable) session.notes = [`${file} could not be read: this session starts with nothing kept.`];
    return session;
  }

  /** The design in use. */
  get graph(): Graph {
    return this.design;
  }

  /** Where this session keeps its state; none, for a graph never saved. */
  get stateFile(): string | null {
    return this.file;
  }

  /** What the last time the session was opened, or handed a graph, dropped of what it kept -- in words. */
  get dropped(): string[] {
    return this.notes;
  }

  /** What each node keeps now that differs from its design, by node id and slot. */
  kept(): Record<string, Record<string, unknown>> {
    return Object.fromEntries([...this.slots].map(([node, slots]) => [node, Object.fromEntries([...slots].map(([key, slot]) => [key, slot.value]))]));
  }

  /** The session as whoever uses the graph sees it: by name, never by node. */
  view(): SessionView {
    const clock = this.application?.clock;
    return {
      session: this.id,
      values: valuesOf(withState(this.design, this.slots).copy, registry),
      outputs: outputsOf(this.design, this.shown, registry),
      rounds: this.count,
      finished_at: this.finishedAt,
      round: this.lastRound ? this.snapshot(this.lastRound) : null,
      dropped: this.notes,
      clock: {
        running: !!clock,
        runs_by_itself: clock?.runsByItself ?? false,
        ticks: clock?.ticks ?? false,
        next_at: clock?.nextAt() ?? null,
        problem: clock?.problem() ?? null,
      },
    };
  }

  /**
   * What the graph asks before a round for *trigger* runs -- of what that
   * round runs only -- given *values*: what it holds now is each question's
   * default, and a value given is no question any more.
   */
  requirements(trigger: Trigger | null, values: Record<string, unknown> = {}): RuntimeRequirement[] {
    const { copy } = withState(this.design, this.slots, values);
    const only = trigger ? triggeredNodes(copy, trigger, memoryFeedbackEdges(copy.nodes, copy.edges, registry)) : null;
    return runtimeRequirements(copy, registry, only).filter((asked) => !(asked.key in values));
  }

  /**
   * Be told what happens in this session from now on: every round as it
   * starts, goes and ends, and the session whenever what it keeps changed.
   * Returns how to stop being told.
   */
  watch(listener: (event: SessionEvent) => void): () => void {
    this.watchers.add(listener);
    return () => { this.watchers.delete(listener); };
  }

  /**
   * Go on with a changed design: what the editor hands over as it is edited.
   * What the session kept for a node that is gone, or a slot whose design
   * changed, is dropped and said; the rest stays. Returns what was said.
   */
  hold(graph: Graph): string[] {
    this.design = graph;
    const { slots, notes } = checked(graph, this.slots);
    this.slots = slots;
    this.notes = notes;
    if (notes.length) {
      void this.save();
      this.tell({ type: 'session', session: this.view() });
    }
    return notes;
  }

  /**
   * Start a round for *trigger* -- the whole graph for none -- given *values*
   * by name, and hand back its id at once, to watch it by. A value the graph
   * takes under no such name is refused before anything starts (`NotOffered`).
   */
  start(trigger: Trigger | null, values: Record<string, unknown> = {}): { id: string; total: number; outcome: Promise<ExecutionResult> } {
    return this.begin(trigger, values);
  }

  /** Run a round and wait for what it produced. *signal* stops it, as Stop does. */
  run(trigger: Trigger | null, values: Record<string, unknown> = {}, signal?: AbortSignal): Promise<ExecutionResult> {
    return this.begin(trigger, values, signal).outcome;
  }

  /** A round as a watcher sees it -- and, once it has ended, what it handed back by name. */
  snapshot(id: string): RoundSnapshot | null {
    const snapshot = this.rounds.snapshot(id);
    if (!snapshot) return null;
    return { ...snapshot, outputs: snapshot.result ? outputsOf(this.design, snapshot.result, registry) : null, whole: this.whole.has(id) };
  }

  stop(id: string): boolean {
    return this.rounds.stop(id);
  }

  /** Stop every round going or waiting, and wait for each to end: see `Rounds.stopAll`. */
  stopAll(): Promise<number> {
    return this.rounds.stopAll();
  }

  /**
   * Start what runs by itself: each trigger node set to fire at start fires,
   * and each with an interval keeps its time (`execution/clock.ts`) -- the one
   * clock a served tool and the editor's ▶ Run keep alike, in the server, so
   * it goes on whether or not a page is open. Its rounds are rounds like any
   * other. Resolves once the rounds starting it have run, with whether a
   * clock goes on ticking.
   */
  async startApplication(): Promise<{ ticks: boolean }> {
    await this.stopApplication();
    const stop = new AbortController();
    const clock = startClock(() => this.design, registry, async (event) => {
      if (stop.signal.aborted) return;
      // A round that could not start says so in its own record; the next may be fine.
      await this.run(event, {}, stop.signal).catch(() => {});
    });
    this.application = { clock, stop };
    this.tell({ type: 'session', session: this.view() });
    await clock.started;
    return { ticks: clock.ticks };
  }

  /** Stop the clock: no round of it starts afterwards, and the one in flight is stopped. */
  async stopApplication(): Promise<void> {
    const running = this.application;
    if (!running) return;
    this.application = null;
    running.stop.abort();
    await running.clock.stop();
    this.tell({ type: 'session', session: this.view() });
  }

  /**
   * Forget everything using the graph left behind, file and all, once the
   * round going now has ended: the graph is as it was designed again.
   */
  reset(): Promise<void> {
    return this.rounds.exclusive(async () => {
      this.slots = new Map();
      this.latch = new Latch();
      this.reuse = new LastOutputs();
      this.shown = null;
      this.count = 0;
      this.finishedAt = null;
      this.notes = [];
      this.lastRound = null;
      await this.writing;
      if (this.file) await rm(this.file, { force: true });
      this.tell({ type: 'session', session: this.view() });
    });
  }

  private begin(trigger: Trigger | null, values: Record<string, unknown>, signal?: AbortSignal) {
    const design = this.design;
    checkValues(design, values, registry);
    const only = trigger ? triggeredNodes(design, trigger, memoryFeedbackEdges(design.nodes, design.edges, registry)) : null;
    const total = only?.size ?? design.nodes.length;
    const labels = new Map(design.nodes.map((node) => [node.id, node.label || node.id]));
    const { id, outcome } = this.rounds.start(total, (node) => labels.get(node) ?? node, (work) => this.round(trigger, values, work), signal);
    this.lastRound = id;
    if (!trigger) {
      this.whole.add(id);
      const forget = (): void => { setTimeout(() => this.whole.delete(id), FORGET_WHOLE_MS).unref(); };
      outcome.then(forget, forget);
    }
    return { id, total, outcome };
  }

  /** One round, on a working copy; what it leaves is kept only once it has run to its end. */
  private async round(trigger: Trigger | null, values: Record<string, unknown>, work: RoundWork): Promise<ExecutionResult> {
    const design = this.design;
    const { copy, sent } = withState(design, this.slots, values);
    const latch = new RoundLatch(this.latch);
    const result = await executeGraph(copy, {
      runtime: this.runtime(work.report), registry, trigger, signal: work.signal, reuse: this.reuse, latch,
    });
    // Stopped: not a round, as a clock's cut off by a shutdown never was.
    if (work.signal.aborted) return result;

    // A message a round delivered was said: emptied, so it is not said again.
    const byId = new Map(copy.nodes.map((node) => [node.id, node]));
    for (const ran of result.node_results) {
      const node = byId.get(ran.node_id);
      if (node && (ran.status === 'success' || ran.status === 'partial')) {
        registry.node(node.node_type)?.clearDelivered(node, sent.get(node.id) ?? {});
      }
    }
    this.slots = slotsOf(copy, design);
    // A design handed over while the round ran is the one that holds now.
    if (this.design !== design) ({ slots: this.slots, notes: this.notes } = checked(this.design, this.slots));
    latch.commit();
    this.shown = this.shown ? mergeResults(this.shown, result) : result;
    this.count += 1;
    this.finishedAt = Date.now();
    await this.save();
    this.tell({ type: 'session', session: this.view() });
    return result;
  }

  /** A round started, began, ended or went a step further: tell the watchers -- how far it is, not more often than they can use. */
  private roundChanged(id: string, moment: boolean): void {
    if (!this.watchers.size) return;
    const now = Date.now();
    if (!moment && now - (this.told.get(id) ?? 0) < PROGRESS_EVERY_MS) return;
    this.told.set(id, now);
    const round = this.snapshot(id);
    if (round?.done) this.told.delete(id);
    if (round) this.tell({ type: 'round', round });
  }

  private tell(event: SessionEvent): void {
    for (const watcher of this.watchers) {
      try {
        watcher(event);
      } catch {
        // One watcher that cannot listen is no reason to stop telling the others.
      }
    }
  }

  /** Take back what the file kept, as far as the design still has a place for it. */
  private recall(kept: StateFile): void {
    const slots: Slots = new Map(Object.entries(kept.slots ?? {}).map(([node, held]) => [node, new Map(Object.entries(held))]));
    ({ slots: this.slots, notes: this.notes } = checked(this.design, slots));
    this.latch.restore(kept.held ?? {});
    this.shown = kept.shown ?? null;
    this.count = Number(kept.rounds) || 0;
    this.finishedAt = kept.finished_at ?? null;
  }

  /** Write the file -- after the write before it, and beside it first, so a crash leaves the one before whole. */
  private save(): Promise<void> {
    const file = this.file;
    if (!file) return Promise.resolve();
    this.writing = this.writing.then(async () => {
      const kept: StateFile = {
        session: this.id,
        graph: this.design.metadata?.name ?? '',
        saved_at: new Date().toISOString(),
        slots: Object.fromEntries([...this.slots].map(([node, slots]) => [node, Object.fromEntries(slots)])),
        held: this.latch.heldBy(new Set(this.design.nodes.map((node) => node.id))),
        shown: this.shown,
        rounds: this.count,
        finished_at: this.finishedAt,
      };
      try {
        await writeFile(`${file}.tmp`, `${JSON.stringify(kept, null, 2)}\n`);
        await rename(`${file}.tmp`, file);
      } catch {
        // A tool in a folder it may not write to still runs; it only forgets on restart.
      }
    });
    return this.writing;
  }
}

/** How a graph is handed over: from which file, and whether it is another document than the one before. */
export interface Handover {
  /** Where the graph is kept, if anywhere: its session keeps its state beside it (`stateFileOf`). */
  path?: string | null;
  /** Another document than the one handed over before -- opened, or started anew: a session of its own. */
  anew?: boolean;
}

/**
 * The session a server holds -- none yet, for the editor, until a graph is
 * handed over -- and the one way a graph is handed over.
 */
export interface SessionHolder {
  session: Session | null;
  /**
   * Go on with *graph*: the session there is, handed a changed design -- or,
   * for another document or another file, a new one, the one before stopped.
   */
  hold(graph: Graph, handover?: Handover): Promise<Session>;
  /**
   * The session a request asks about: the one held -- unless it names
   * another, which is not here: a 404 that sends a page back to the interface.
   */
  asked(id?: string): Session;
}

/** A holder of *session*, or of none until a graph is handed to it. */
export function holderOf(session: Session | null = null): SessionHolder {
  return {
    session,
    asked(id) {
      if (!this.session) throw new Refusal(404, 'This server holds no graph yet.');
      if (id && id !== this.session.id) {
        throw new Refusal(404, `No session "${id}" here: this server's is "${this.session.id}". Ask for its interface again.`);
      }
      return this.session;
    },
    async hold(graph, { path = null, anew = false } = {}) {
      const file = path ? stateFileOf(path) : null;
      const before = this.session;
      if (before && !anew && before.stateFile === file) {
        before.hold(graph);
        return before;
      }
      if (before) {
        await before.stopApplication();
        await before.stopAll();
      }
      this.session = await Session.open(graph, { file });
      return this.session;
    },
  };
}

/**
 * What a round leaves in the latch, held back until the round has run to its
 * end. Asked within the round, it answers with what the round left so far.
 */
class RoundLatch extends Latch {
  private readonly session: Latch;
  private readonly written = new Map<string, Record<string, unknown>>();

  constructor(session: Latch) {
    super();
    this.session = session;
  }

  override key(graph: Graph, node: GraphNode, keepsItsOwn: (node: GraphNode) => boolean): string {
    return this.session.key(graph, node, keepsItsOwn);
  }

  override get(key: string): Record<string, unknown> | undefined {
    return this.written.get(key) ?? this.session.get(key);
  }

  override set(key: string, outputs: Record<string, unknown>): void {
    this.written.set(key, outputs);
  }

  commit(): void {
    for (const [key, outputs] of this.written) this.session.set(key, outputs);
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * *design* with what the session keeps put back into it and *values* put in by
 * name -- what a round starts from -- and each node's slots as it is handed them.
 */
function withState(design: Graph, slots: Slots, values: Record<string, unknown> = {}): { copy: Graph; sent: Map<string, Record<string, unknown>> } {
  const copy = structuredClone(design);
  for (const node of copy.nodes) {
    const held = slots.get(node.id);
    if (held) registry.node(node.node_type)?.setState(node, Object.fromEntries([...held].map(([key, slot]) => [key, slot.value])));
  }
  applyValues(copy, values, registry);
  const sent = new Map<string, Record<string, unknown>>();
  for (const node of copy.nodes) {
    const now = registry.node(node.node_type)?.state(node) ?? {};
    if (Object.keys(now).length) sent.set(node.id, now);
  }
  return { copy, sent };
}

/** What each node of *copy* keeps that differs from what *design* says it holds. */
function slotsOf(copy: Graph, design: Graph): Slots {
  const designed = new Map(design.nodes.map((node) => [node.id, node]));
  const slots: Slots = new Map();
  for (const node of copy.nodes) {
    const element = registry.node(node.node_type);
    const plan = designed.get(node.id);
    if (!element || !plan) continue;
    const defaults = element.state(plan);
    for (const [key, value] of Object.entries(element.state(node))) {
      if (!(key in defaults) || same(value, defaults[key])) continue;
      if (!slots.has(node.id)) slots.set(node.id, new Map());
      slots.get(node.id)!.set(key, { value, default: defaults[key] });
    }
  }
  return slots;
}

/** What of *slots* *design* still has a place for, and what it has not, in words. */
function checked(design: Graph, slots: Slots): { slots: Slots; notes: string[] } {
  const byId = new Map(design.nodes.map((node) => [node.id, node]));
  const kept: Slots = new Map();
  const notes: string[] = [];
  for (const [nodeId, held] of slots) {
    const node = byId.get(nodeId);
    if (!node) {
      notes.push(`What "${nodeId}" kept was dropped: it is no longer in the graph.`);
      continue;
    }
    const designed = registry.node(node.node_type)?.state(node) ?? {};
    for (const [key, slot] of held) {
      if (!(key in designed)) notes.push(`What "${nodeId}" kept in "${key}" was dropped: "${key}" is no longer there.`);
      else if (!same(designed[key], slot.default)) notes.push(`What "${nodeId}" kept in "${key}" was dropped: its design changed.`);
      else {
        if (!kept.has(nodeId)) kept.set(nodeId, new Map());
        kept.get(nodeId)!.set(key, slot);
      }
    }
  }
  return { slots: kept, notes };
}
