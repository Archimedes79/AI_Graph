// Running a chart's own code, where the chart is drawn.
//
// A chart's body used to be a *transform*: it ran on the server, once per run,
// and what came back was stored as the drawn value. That meant it could not be
// told the two things it most needed -- how big the block is and which colour
// scheme the page is in -- because neither exists when a run happens. The
// contract papered over it with a fixed viewBox and `currentColor`, and said
// out loud that the scheme "can change after you are done".
//
// So it runs here instead, at draw time, and is handed them. A resize or a
// switch of scheme redraws with no run at all, and the empty window stops being
// a special case: `draw(null, …)` is the same function on the same path, which
// is what a block with nothing in it has always needed.
//
// **In a worker**, not in the page. The body is the graph author's, and a graph
// travels; giving it the page's DOM, its origin and its storage to write a bar
// chart would be a poor trade. A worker has none of those, and the body needs
// none of them -- data in, points or a string of SVG out. It is also how a body
// that loops forever costs a chart rather than the tool: nothing answers, the
// timeout fires, the worker is destroyed.

/** What a body is told about the window it is drawing into. */
export interface DrawWindow {
  /** The block's real size on screen, in pixels. */
  width: number;
  height: number;
  /** The page's colour scheme, by name, and which way up it is. */
  scheme: string;
  dark: boolean;
}

export interface Drawn {
  /** Points, or a string of SVG: the same two answers as before. */
  value?: unknown;
  /** Why nothing was drawn. Cosmetic — a chart's failure costs the chart. */
  error?: string;
}

/**
 * More than this and the body is not slow, it is stuck.
 *
 * Generous, because a chart of a few thousand points is real work, and it is
 * spent off the main thread anyway. Short enough that a stuck body shows a
 * message while the person is still looking at the block.
 */
const PATIENCE_MS = 4000;

/**
 * The worker, as source.
 *
 * `draw(data, window)` is what is asked for. `run(inputs)` is accepted too,
 * because that is what every chart written until now defines, and a graph that
 * worked yesterday must work today: it is called with the old shape and its
 * answer unwrapped the old way.
 */
const WORKER = `
self.onmessage = (event) => {
  const { code, data, window } = event.data;
  try {
    const make = new Function(code + '\\nreturn { draw: typeof draw === "function" ? draw : undefined, run: typeof run === "function" ? run : undefined };');
    const found = make();
    if (!found.draw && !found.run) {
      self.postMessage({ error: 'This chart\\'s code defines neither draw(data, window) nor run(inputs).' });
      return;
    }
    const answer = found.draw ? found.draw(data, window) : found.run({ value: data }, window);
    Promise.resolve(answer).then(
      (result) => {
        // Either shape: a bare value, or { value } as a transform returned.
        const value = result && typeof result === 'object' && 'value' in result ? result.value : result;
        self.postMessage({ value });
      },
      (reason) => self.postMessage({ error: String(reason && reason.message ? reason.message : reason) }),
    );
  } catch (reason) {
    self.postMessage({ error: String(reason && reason.message ? reason.message : reason) });
  }
};
`;

let blobUrl: string | null = null;

/** One blob for every chart on the page: the source never differs. */
function workerUrl(): string {
  if (!blobUrl) blobUrl = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
  return blobUrl;
}

/**
 * Draw *data* with this block's *code*, and give up after a while.
 *
 * Resolves rather than rejects: a chart that cannot be drawn is a message in
 * the block, never a failure that reaches the page around it.
 */
export function draw(code: string, data: unknown, about: DrawWindow): Promise<Drawn> {
  if (!code.trim()) return Promise.resolve({ value: data });
  // No worker to be had (a test in jsdom, an old browser): the chart falls
  // back to drawing whatever arrived, which is what an empty body does.
  if (typeof Worker === 'undefined') return Promise.resolve({ value: data });

  return new Promise<Drawn>((settle) => {
    let worker: Worker;
    try {
      worker = new Worker(workerUrl());
    } catch {
      settle({ value: data });
      return;
    }
    const done = (answer: Drawn) => {
      clearTimeout(patience);
      worker.terminate();
      settle(answer);
    };
    const patience = setTimeout(
      () => done({ error: `This chart's code did not finish within ${PATIENCE_MS / 1000}s.` }),
      PATIENCE_MS,
    );
    worker.onmessage = (event) => done(event.data as Drawn);
    worker.onerror = (event) => done({ error: event.message || 'This chart\'s code could not be run.' });
    // Structured clone: anything that arrived through the graph is JSON, so
    // there is nothing here a worker cannot be handed.
    try {
      worker.postMessage({ code, data, window: about });
    } catch {
      done({ error: 'What arrived at this chart cannot be handed to its code.' });
    }
  });
}
