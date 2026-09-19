// What a served tool holds while it runs, and how it lets go of it.
//
// A server has a clock that starts rounds, runs a page started, children those
// runs spawned, and a socket. Each could always be stopped; nothing ever did.
// Ctrl+C, a closed terminal and `docker stop` all ended the process where it
// stood: a model call still billed and never read, a scheduled round cut off
// while writing the file it remembers itself in, and -- as PID 1 in a
// container, which gets no default signal handling -- ten seconds of ignoring
// SIGTERM before being killed.
//
// So the things that must be stopped are written down in one list, by whoever
// starts them, and stopped in the order they were started: what *makes* work
// before what carries it. A clock goes before the runs, the runs before the
// server that still has to answer "cancelled" to the page watching them.
//
// Deliberately small. It owns no resources and knows none of them; it is the
// order, the patience and the promise that stopping happens once.

/** How long stopping may take before the process ends anyway. */
export const GRACE_MS = 8000;

interface Owned {
  name: string;
  stop: () => unknown;
}

export class Lifecycle {
  private readonly owned: Owned[] = [];
  private ending: Promise<string[]> | null = null;

  /** Write down something that must be stopped. *stop* may be async, and may fail. */
  own(name: string, stop: () => unknown): void {
    this.owned.push({ name, stop });
  }

  get stopping(): boolean {
    return this.ending !== null;
  }

  /**
   * Stop everything, once, and say what would not stop.
   *
   * One failure or one step that hangs does not strand the rest: each is given
   * what is left of *graceMs*, and the names of those that threw or ran out of
   * time are the answer. Asking again returns the same stop, not a second one.
   */
  shutdown(graceMs = GRACE_MS): Promise<string[]> {
    this.ending ??= this.stopAll(graceMs);
    return this.ending;
  }

  private async stopAll(graceMs: number): Promise<string[]> {
    const deadline = Date.now() + graceMs;
    const stuck: string[] = [];
    for (const { name, stop } of this.owned) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<'late'>((resolve) => {
        timer = setTimeout(() => resolve('late'), Math.max(0, deadline - Date.now()));
      });
      try {
        const outcome = await Promise.race([Promise.resolve().then(stop), late]);
        if (outcome === 'late') stuck.push(name);
      } catch {
        stuck.push(name);
      } finally {
        clearTimeout(timer);
      }
    }
    return stuck;
  }
}

/** Anything that can say "you are being asked to stop": `process`, or a test's emitter. */
interface SignalSource {
  on(signal: string, listener: () => void): unknown;
  off(signal: string, listener: () => void): unknown;
}

/** Ctrl+C, a supervisor or `docker stop`, a closed terminal, and Ctrl+Break on Windows. */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];

/**
 * Wait for a stop signal, shut down, and resolve to the exit code.
 *
 * Zero for a stop that was asked for and went through; one when something
 * would not stop. A second signal while stopping means "now": *force* is
 * called, which for a process is `process.exit`.
 */
export function untilStopped(
  shutdown: () => Promise<string[]>,
  options: { signals?: SignalSource; force?: (code: number) => void; log?: (line: string) => void } = {},
): Promise<number> {
  const signals = options.signals ?? process;
  const force = options.force ?? ((code: number) => process.exit(code));
  const log = options.log ?? ((line: string) => { process.stderr.write(`${line}\n`); });

  return new Promise((resolve) => {
    let asked = false;
    const onSignal = (): void => {
      if (asked) return force(130);
      asked = true;
      log('Stopping: ending runs in flight. Again to stop at once.');
      void shutdown().then((stuck) => {
        for (const signal of STOP_SIGNALS) signals.off(signal, onSignal);
        if (stuck.length) log(`Did not stop in time: ${stuck.join(', ')}.`);
        resolve(stuck.length ? 1 : 0);
      });
    };
    for (const signal of STOP_SIGNALS) signals.on(signal, onSignal);
  });
}
