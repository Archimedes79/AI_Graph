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
  type Failure, type RequestOf, type ResponseOf, type RouteName,
} from '@engine/host/api.ts';
import type { EngineGraph, Graph } from '../types/graph';

export type {
  AICall, BrowsePage, GenerateRequest, GenerateResponse, ProbeReport, ProviderStatus, Requirement,
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
 * the editor's typed view of the same document (see `types/graphModel.ts`).
 */
type EditorView<T> =
  T extends EngineGraph ? Graph
    : T extends { graph: EngineGraph } ? Omit<T, 'graph'> & { graph: Graph }
      : T;

/**
 * Call one route of the contract.
 *
 * GET and DELETE carry the request on the query; POST as a JSON body, or as
 * the bytes themselves for a raw route. `:params` are filled into the path.
 */
export async function call<K extends RouteName>(name: K, request?: RequestOf<K>): Promise<EditorView<ResponseOf<K>>> {
  const route = API[name];
  const { path, rest } = pathFor(name, (request ?? {}) as Record<string, unknown>);
  let url = path;
  let body: BodyInit | undefined;
  const headers: Record<string, string> = {};

  if (route.raw) {
    const { bytes, ...query } = rest as { bytes: BodyInit };
    url += `?${new URLSearchParams(query as Record<string, string>)}`;
    body = bytes;
    headers['Content-Type'] = 'application/octet-stream';
  } else if (route.method === 'POST') {
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
  return (type.includes('application/json') ? response.json() : response.blob()) as Promise<EditorView<ResponseOf<K>>>;
}

/** Save the deploy bundle the way a browser saves any download. */
export async function downloadBundle(graph: RequestOf<'bundle'>): Promise<void> {
  const zip = await call('bundle', graph) as Blob;
  const url = URL.createObjectURL(zip);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${graph.metadata.name.toLowerCase().replace(/\s+/g, '_')}_bundle.zip`;
  link.click();
  URL.revokeObjectURL(url);
}
