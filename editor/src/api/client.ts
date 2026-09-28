// The page's end of the wire: the routes of `engine/src/host/api.ts`, called by name.
//
// The mirror of `serve.ts`. The server serves that table and this calls it, so
// a route's path, method and the shapes going each way are written once, in
// the engine, and both ends are checked against them by the compiler. What is
// left here is the calling: how a request becomes a URL and a body, and a
// failure an `ApiError` whose message is the server's own `detail`.
//
// No clock on any call. A local model asked to design a whole graph takes as
// long as it takes, and a browser that gives up first turns a slow answer into
// no answer -- with the request still running on the other side.
import {
  API, pathFor,
  type AICall, type Failure, type RequestOf, type ResponseOf, type RouteName,
} from '@engine/host/api.ts';
import type { EngineGraph, Graph } from '@/graph';

export type {
  AICall, BrowseEntry, BrowsePage, GenerateRequest, GenerateResponse, ProbeReport, ProviderStatus, Requirement,
  RunSnapshot, RunTrigger, SettingsPatch, SettingsStatus, ToolAiSettings,
} from '@engine/host/api.ts';
export type { ScheduleState } from '@engine/host/schedule.ts';

/** A call the server answered with an error. `message` is its `detail`; `body` the rest of what it said. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Partial<Failure>;
  constructor(status: number, body: Partial<Failure>) {
    super(body.detail || `The server answered ${status}.`);
    this.status = status;
    this.body = body;
  }
}

/**
 * A response as the editor holds it: a graph the engine sends back is taken as
 * the editor's typed view of the same document (see `graph.ts`).
 */
type EditorView<T> =
  T extends EngineGraph ? Graph
    : T extends { graph: EngineGraph } ? Omit<T, 'graph'> & { graph: Graph }
      : T;

/**
 * Call one route of the contract.
 *
 * GET and DELETE carry the request on the query; POST as a JSON body.
 * `:params` are filled into the path.
 */
export async function call<K extends RouteName>(name: K, request?: RequestOf<K>): Promise<EditorView<ResponseOf<K>>> {
  const route = API[name];
  const { path, rest } = pathFor(name, (request ?? {}) as Record<string, unknown>);
  let url = path;
  let body: BodyInit | undefined;
  const headers: Record<string, string> = {};

  if (route.method === 'POST') {
    body = JSON.stringify(rest);
    headers['Content-Type'] = 'application/json';
  } else if (Object.keys(rest).length) {
    url += `?${new URLSearchParams(rest as Record<string, string>)}`;
  }

  const response = await fetch(url, { method: route.method, headers, body });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as Partial<Failure>;
    throw new ApiError(response.status, failure);
  }
  const type = response.headers.get('Content-Type') ?? '';
  if (type.includes('application/json')) return response.json() as Promise<EditorView<ResponseOf<K>>>;
  // A download, named by the server (`Download`): a File, which is a Blob
  // that also carries that name, so no caller works the name out again.
  const blob = await response.blob();
  const named = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download';
  return new File([blob], named, { type: blob.type }) as EditorView<ResponseOf<K>>;
}

/**
 * Run a generation, and hand *onCalls* what it has sent so far while it runs.
 *
 * A generation is several model calls over a minute or more. Asking every half
 * second what has gone out turns that wait into something a person can read
 * and judge -- the prompt, the context, each step. *run* is handed the id to
 * send as `progress_id`, which is what the engine files the calls under. A
 * poll that fails changes nothing: the generation is what matters. A node's
 * panel and ✨ AI Graph each wrote this out.
 *
 * *stop* ends the watch at once, rejecting with its reason: the request goes
 * on at the server, and what it brings back is dropped -- a call that hung
 * held a node's every ✨ until it ended.
 */
export async function watchGeneration<T>(
  run: (progressId: string) => Promise<T>,
  onCalls: (calls: AICall[]) => void,
  stop?: AbortSignal,
): Promise<T> {
  const progressId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const polling = setInterval(async () => {
    try {
      const { calls } = await call('generationProgress', { id: progressId });
      if (calls.length && !stop?.aborted) onCalls(calls);
    } catch {
      // Nothing to do: the next poll, or the generation's own answer, says more.
    }
  }, 500);
  const stopped = new Promise<never>((_, reject) => {
    stop?.addEventListener('abort', () => reject(stop.reason), { once: true });
  });
  try {
    return await Promise.race([run(progressId), stopped]);
  } finally {
    clearInterval(polling);
  }
}

/** Save the deploy bundle the way a browser saves any download, under the name the engine gave it. */
export async function downloadBundle(graph: RequestOf<'bundle'>): Promise<void> {
  const zip = await call('bundle', graph);
  const url = URL.createObjectURL(zip);
  const link = document.createElement('a');
  link.href = url;
  link.download = zip.name;
  link.click();
  URL.revokeObjectURL(url);
}
