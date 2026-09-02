// Serving a deployed tool: the page, and the few endpoints it calls.
//
// A bundle with an interface is a static page plus a local server. The page is
// the *same build* the designer previewed — copied, not regenerated — and this
// serves it along with the handful of routes it talks to.
//
// Deliberately not vendored from the editor's API: a deployed tool must not
// offer code generation, graph editing or anything else that only makes sense
// while building. What it offers is the graph it ships, a way to run it, and
// the file picker its own blocks need. That list is the security boundary, so
// it is written out here rather than assembled from a router someone might
// extend later without noticing where it ends up.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { parseGraph, type ExecutionResult, type Graph } from '../graph.ts';
import { executeGraph } from '../executor.ts';
import { registry } from '../registry.ts';
import { authoredIn, generations } from '../describe.ts';
import type { SettingsPatch } from './editor/settings.ts';
import type * as ProjectModule from './editor/project.ts';
import type * as GenerateModule from './editor/generate.ts';
import { writeBundle } from '../bundle.ts';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { applyRuntimeValues, runtimeRequirements } from '../runtimeValues.ts';
import { nodeFiles, nodeRuntime } from './node.ts';

/**
 * A run in flight, so the page can watch it and stop it.
 *
 * The fields are the ones `RunSnapshot` in the page's own client declares —
 * read from there rather than invented, because a snapshot missing `done` looks
 * to the page exactly like a run that never finishes. `completed/total` counts
 * nodes, which does not move while one node grinds through a 500-item batch;
 * `item_done/item_total` is what moves then, and the two cases that look like a
 * hang are exactly those.
 */
interface Run {
  id: string;
  total: number;
  completed: number;
  running: string[];
  currentLabel: string;
  itemDone: number;
  itemTotal: number;
  lastActivity: number | null;
  result: ExecutionResult | null;
  error: string | null;
  cancelled: boolean;
  finishedAt: number | null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface ServeOptions {
  /**
   * The graph this server ships, for a deployed tool.
   *
   * Optional, because the editor starts this alongside itself purely to run
   * graphs: it posts the one being edited with every request, so there is
   * nothing stored to serve. Only `/api/runtime/graph` needs it.
   */
  graphPath?: string;
  /** Where the built page lives, if this bundle carries one. */
  pageDir?: string;
  port?: number;
  /**
   * Let the page list directories.
   *
   * Loopback only, and that is not a detail: on 0.0.0.0 it would expose this
   * machine's filesystem listing to the network, which is a different thing
   * from letting the person at the keyboard choose their own file.
   */
  allowBrowse?: boolean;
  host?: string;
  /**
   * Serve the editor instead of a deployed page: `dist` is the built editor.
   *
   * The same server either way. A deployed tool gets the page and the few
   * routes it needs; the editor gets those plus its own -- files, settings, a
   * project on disk, generation, a bundle -- loaded only when this is the
   * editor, so none of it is ever vendored into a bundle.
   */
  editor?: { dist: string };
}

export async function serve(options: ServeOptions): Promise<{ server: Server; url: string }> {
  const host = options.host ?? '127.0.0.1';
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const allowBrowse = (options.allowBrowse ?? true) && loopback;
  const runs = new Map<string, Run>();
  /**
   * Transcripts of generations still in flight, by the id the editor sent.
   *
   * A generation is several model calls over a minute or more and shows
   * nothing until it returns. The array here is the one `generate` is writing
   * into, so a poll sees the prompt, the context and each step as they happen.
   * Dropped when the generation ends -- the reply carries the final transcript.
   */
  const generating = new Map<string, GenerateModule.AICall[]>();

  // The editor's own routes are loaded only when this is the editor. A bundle
  // vendors this file without the `editor/` folder beside it, and a static
  // import would make every deployed tool fail to start for want of code it
  // must not carry.
  const editor = options.editor
    ? {
      files: await import('./editor/files.ts'),
      settings: await import('./editor/settings.ts'),
      project: await import('./editor/project.ts'),
      generate: await import('./editor/generate.ts'),
      zip: await import('./editor/zip.ts'),
    }
    : null;

  const original = options.graphPath
    ? parseGraph(JSON.parse(await readFile(options.graphPath, 'utf8')))
    : null;

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      send(response, 500, { detail: error instanceof Error ? error.message : String(error) });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${host}`);
    const path = url.pathname;

    if (path === '/api/runtime/graph') {
      if (!original) return send(response, 404, { detail: 'This server ships no graph; post the one to run.' });
      return send(response, 200, original);
    }

    if (path === '/api/execute/requirements' && request.method === 'POST') {
      const graph = parseGraph(await body(request));
      return send(response, 200, runtimeRequirements(graph, registry).map(asRequirement));
    }

    // Where this graph's authored bodies live. Describing a graph the caller
    // already holds is neither code generation nor graph editing, so it sits
    // inside the boundary above: the editor asks the elements instead of
    // keeping a second opinion about which config key holds a node's code.
    if (path === '/api/elements/generation') {
      return send(response, 200, generations());
    }

    if (path === '/api/elements/authored' && request.method === 'POST') {
      const graph = parseGraph(await body(request));
      return send(response, 200, authoredIn(graph));
    }

    if (path === '/api/execute/' && request.method === 'POST') {
      const graph = parseGraph(await body(request));
      return send(response, 200, await run(graph));
    }

    if (path === '/api/execute/start' && request.method === 'POST') {
      const graph = parseGraph(await body(request));
      return send(response, 200, { run_id: start(graph), total: graph.nodes.length });
    }

    const watching = /^\/api\/execute\/runs\/([^/]+)$/.exec(path);
    if (watching) {
      const found = runs.get(watching[1]);
      if (!found) return send(response, 404, { detail: 'No such run.' });
      return send(response, 200, snapshot(found));
    }

    const stopping = /^\/api\/execute\/runs\/([^/]+)\/cancel$/.exec(path);
    if (stopping && request.method === 'POST') {
      const found = runs.get(stopping[1]);
      if (found) found.cancelled = true;
      return send(response, 200, { cancelled: Boolean(found) });
    }

    if (path === '/api/files/browse' && request.method === 'POST') {
      if (!allowBrowse) return send(response, 403, { detail: 'Browsing is disabled.' });
      const asked = await body(request) as { path?: string; extensions?: string };
      if (!options.editor) return send(response, 200, await browse(asked.path ?? '.', asked.extensions ?? ''));
      // The editor walks into directories and jumps between drives; a deployed
      // page only picks a file, and lists nothing it would not need to.
      try {
        const filter = editor!.files.extensionFilter(asked.extensions ?? '');
        return send(response, 200, await editor!.files.browse(asked.path ?? '', filter));
      } catch (error) {
        return send(response, error instanceof editor!.files.NotFound ? 404 : 400, { detail: message(error) });
      }
    }

    const projectRoute = /^\/api\/graphs\/file\/(load|save|reload-nodes)$/.exec(path);
    if (options.editor && projectRoute && request.method === 'POST') {
      return projectRequest(response, editor!.project, projectRoute[1], await body(request) as { path?: string; graph?: unknown });
    }

    if (options.editor && path === '/api/ai/generate' && request.method === 'POST') {
      const asked = await body(request) as GenerateModule.GenerateRequest
        & { ai_provider?: string; ai_model?: string; progress_id?: string };
      return generateRequest(response, editor!.generate, editor!.settings, asked, generating);
    }

    // What the generation with this id has sent and received so far. Empty
    // until the first call goes out, and gone once the generation returns.
    if (options.editor && path === '/api/ai/generate/progress' && request.method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      return send(response, 200, { calls: generating.get(id) ?? [], done: !generating.has(id) });
    }

    if (options.editor && path === '/api/ai/generate-graph' && request.method === 'POST') {
      const asked = await body(request) as {
        description?: string; context?: string; ai_provider?: string; ai_model?: string; progress_id?: string;
      };
      const target = await editor!.settings.generationTarget(asked.ai_provider ?? '', asked.ai_model ?? '');
      // Watchable for the same reason one element's generation is: designing a
      // whole graph is one long call, and until it lands there is nothing to
      // see but a spinning button.
      const calls: GenerateModule.AICall[] = [];
      if (asked.progress_id) generating.set(asked.progress_id, calls);
      try {
        const { graph, explanation } = await editor!.generate.generateGraph(
          asked.description ?? '', asked.context ?? '', { ai: nodeRuntime().ai, target, calls },
        );
        return send(response, 200, { graph: parseGraph(graph), explanation });
      } catch (error) {
        const failed = error instanceof editor!.generate.GenerationFailed ? error.calls : calls;
        return send(response, 500, { detail: message(error), calls: failed });
      } finally {
        if (asked.progress_id) generating.delete(asked.progress_id);
      }
    }

    if (options.editor && path === '/api/deploy/bundle' && request.method === 'POST') {
      const graph = parseGraph(await body(request));
      const work = await mkdtemp(join(tmpdir(), 'ai-graph-bundle-'));
      try {
        // The built page, when this checkout has one -- looked up the way the
        // CLI looks it up, so a bundle from the editor is the bundle from `--bundle`.
        const built = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'editor', 'dist');
        const pageDir = existsSync(join(built, 'runtime.html')) ? built : undefined;
        await writeBundle(graph, work, { pageDir });
        const entries = [];
        for (const file of await allFiles(work)) {
          entries.push({ path: file.slice(work.length + 1), content: await readFile(file) });
        }
        const name = (graph.metadata.name || 'graph').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'graph';
        response.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${name}_bundle.zip"`,
        });
        return void response.end(editor!.zip.zip(entries));
      } catch (error) {
        return send(response, 500, { detail: `The engine could not write the bundle: ${message(error)}` });
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    }

    if (options.editor && path === '/api/ai/settings' && request.method === 'GET') {
      return send(response, 200, editor!.settings.status());
    }

    if (options.editor && path === '/api/ai/settings' && request.method === 'POST') {
      try {
        return send(response, 200, await editor!.settings.save(await body(request) as SettingsPatch));
      } catch (error) {
        return send(response, 500, { detail: `Could not write ${editor!.settings.settingsPath()}: ${message(error)}` });
      }
    }

    if (options.editor && path === '/api/ai/providers') {
      return send(response, 200, await editor!.settings.providerStatus());
    }

    if (options.editor && path === '/api/files/detect-format' && request.method === 'POST') {
      const asked = await body(request) as { path?: string };
      if (!asked.path) return send(response, 400, { detail: "Missing required field 'path'" });
      try {
        return send(response, 200, { format: await editor!.files.detectFormat(asked.path) });
      } catch (error) {
        return send(response, 404, { detail: message(error) });
      }
    }

    if (options.editor && path === '/api/files/attachments' && request.method === 'POST') {
      // The file itself is the body; its name rides on the query. No multipart
      // to parse, and nothing about the upload a client could get wrong.
      const name = url.searchParams.get('name') ?? 'attachment';
      const saved = await editor!.files.saveAttachment(name, await rawBody(request));
      return send(response, 200, { path: saved, name });
    }

    if (options.editor && path === '/api/files/attachments' && request.method === 'DELETE') {
      try {
        await editor!.files.deleteAttachment(url.searchParams.get('path') ?? '');
        return send(response, 200, { ok: true });
      } catch (error) {
        return send(response, 400, { detail: message(error) });
      }
    }

    if (path === '/api/runtime/ai-settings') {
      // Read-only here: a deployed tool is configured through its environment,
      // which is what the README tells its recipient. Writing settings from a
      // page would put credentials in a file nobody asked for.
      return send(response, 200, {
        provider: process.env.AI_GRAPH_AI_PROVIDER ?? '',
        model: process.env.AI_GRAPH_AI_MODEL ?? '',
        force: false,
        settings_file: '(configured through the environment)',
        settings_file_exists: false,
      });
    }

    if (path.startsWith('/api/')) return send(response, 404, { detail: 'Not part of a deployed tool.' });

    if (options.editor) return page(response, path, options.editor.dist, 'index.html');
    return options.pageDir ? page(response, path, options.pageDir, 'runtime.html') : send(response, 404, { detail: 'No page.' });
  }

  async function run(graph: Graph): Promise<ExecutionResult> {
    applyRuntimeValues(graph, {}, registry);
    return executeGraph(graph, { runtime: nodeRuntime(), registry });
  }

  /** Start a run in the background and hand back its id, for a page that watches. */
  function start(graph: Graph): string {
    const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const record: Run = {
      id, total: graph.nodes.length, completed: 0, running: [], currentLabel: '',
      itemDone: 0, itemTotal: 0, lastActivity: null,
      result: null, error: null, cancelled: false, finishedAt: null,
    };
    runs.set(id, record);

    const runtime = nodeRuntime({
      report(event) {
        record.lastActivity = Date.now();
        if (event.type === 'node_start') {
          record.currentLabel = graph.nodes.find((n) => n.id === event.node_id)?.label ?? event.node_id;
          record.running = [...record.running, event.node_id];
          record.itemDone = 0;
          record.itemTotal = 0;
        }
        if (event.type === 'node_done') {
          record.completed += 1;
          record.running = record.running.filter((id) => id !== event.node_id);
        }
        if (event.type === 'batch') {
          record.itemDone = event.done;
          record.itemTotal = event.total;
        }
      },
    });

    executeGraph(graph, { runtime, registry })
      .then((result) => { record.result = result; })
      .catch((error: unknown) => { record.error = error instanceof Error ? error.message : String(error); })
      .finally(() => { record.finishedAt = Date.now(); forget(); });

    return id;
  }

  /** Finished runs linger briefly, then go: a long session must not accumulate them. */
  function forget(): void {
    const cutoff = Date.now() - 300_000;
    for (const [id, record] of runs) {
      if (record.finishedAt !== null && record.finishedAt < cutoff) runs.delete(id);
    }
  }

  async function browse(path: string, extensions: string): Promise<unknown> {
    const target = resolve(path);
    const suffixes = extensions.split(',').map((e) => e.trim()).filter(Boolean)
      .map((e) => (e.startsWith('.') ? e : `.${e}`));
    const files = await nodeFiles.list(target, {
      extensions: suffixes.length ? suffixes : undefined,
    });
    return { path: target, entries: files.map((file) => ({ path: file, is_dir: false })) };
  }

  async function page(response: ServerResponse, path: string, dir: string, entry: string): Promise<void> {
    // Anything that is not a file is the page itself: the runtime is a single
    // page, so a deep link is still that page rather than a 404.
    const wanted = path === '/' ? `/${entry}` : path;
    const full = join(dir, normalize(wanted).replace(/^([/\\])+/, ''));
    if (!full.startsWith(resolve(dir) + sep) && full !== resolve(dir)) {
      return send(response, 403, { detail: 'Outside the page.' });
    }
    try {
      const found = await stat(full);
      if (!found.isFile()) throw new Error('not a file');
      response.writeHead(200, { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream' });
      response.end(await readFile(full));
    } catch {
      try {
        const html = await readFile(join(dir, entry));
        response.writeHead(200, { 'Content-Type': MIME['.html'] });
        response.end(html);
      } catch {
        send(response, 404, { detail: `No ${entry} in ${dir}. Build the editor first: cd editor && npm run build` });
      }
    }
  }

  await new Promise<void>((listening) => server.listen(options.port ?? 0, host, listening));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://${host}:${port}` };
}

/**
 * The editor's Open, Save and Reload, with the project layer's refusals turned
 * into the status codes the editor reads: a file that is not there, a file
 * that is not a graph, and a node file changed outside since it was opened.
 */
async function projectRequest(
  response: ServerResponse,
  project: typeof ProjectModule,
  action: string,
  asked: { path?: string; graph?: unknown },
): Promise<void> {
  const path = resolve(expandHome(String(asked.path ?? '')));
  if (!asked.path) return send(response, 400, { detail: "Missing required field 'path'" });
  try {
    const graph = action === 'save'
      ? await project.save(path, project.asGraph(asked.graph))
      : await project.load(path);
    return send(response, 200, { path, graph });
  } catch (error) {
    if (error instanceof project.NotFound) return send(response, 404, { detail: error.message });
    if (error instanceof project.NotAGraph) return send(response, 400, { detail: error.message });
    if (error instanceof project.FileChanged) return send(response, 409, { detail: error.message });
    return send(response, 400, { detail: `Could not ${action} graph file: ${message(error)}` });
  }
}

/**
 * One element's body, written by the model the editor named.
 *
 * The element's declaration comes from the registry, the model from the
 * settings layer, the sandbox from this machine -- the same three the graph
 * runs with, which is what keeps a generated body runnable by the run.
 */
async function generateRequest(
  response: ServerResponse,
  gen: typeof GenerateModule,
  settings: { generationTarget: (provider: string, model: string) => Promise<{ provider: string; model: string }> },
  asked: GenerateModule.GenerateRequest & { ai_provider?: string; ai_model?: string; progress_id?: string },
  watching?: Map<string, GenerateModule.AICall[]>,
): Promise<void> {
  const target = await settings.generationTarget(asked.ai_provider ?? '', asked.ai_model ?? '');
  const runtime = nodeRuntime();
  // Registered before the first call, so a poll that arrives early sees an
  // empty transcript rather than a 'not found' it would have to interpret.
  const calls: GenerateModule.AICall[] = [];
  const id = asked.progress_id;
  if (id && watching) watching.set(id, calls);
  try {
    const reply = await gen.generate(asked, {
      ai: runtime.ai,
      code: runtime.code,
      generationFor: (name) => registry.node(name)?.generation() ?? registry.widget(name)?.generation(),
      target,
      calls,
    });
    return send(response, 200, reply);
  } catch (error) {
    if (error instanceof gen.GenerationRefused) return send(response, 400, { detail: error.message });
    // The failing generation is the one whose transcript is worth reading, so
    // it travels with the error in the same shape a success has.
    const failed = error instanceof gen.GenerationFailed ? error.calls : calls;
    return send(response, 500, { detail: message(error), calls: failed });
  } finally {
    if (id && watching) watching.delete(id);
  }
}

async function allFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await allFiles(full));
    else found.push(full);
  }
  return found.sort();
}

/** `~/x` as the person meant it: their home, not a folder called `~`. */
function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith(`~${String.fromCharCode(92)}`)) return join(homedir(), path.slice(2));
  return path;
}

/** The request body as it came: an upload is bytes, not JSON. */
function rawBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => done(Buffer.concat(chunks)));
    request.on('error', fail);
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function snapshot(record: Run): unknown {
  return {
    run_id: record.id,
    done: record.finishedAt !== null,
    cancelled: record.cancelled,
    completed: record.completed,
    total: record.total,
    running: record.running,
    current_label: record.currentLabel,
    item_done: record.itemDone,
    item_total: record.itemTotal,
    idle_seconds: record.lastActivity === null ? null : (Date.now() - record.lastActivity) / 1000,
    error: record.error,
    result: record.result,
  };
}

function asRequirement(requirement: { key: string; label: string; kind: string; direction: string; current: string }) {
  const [nodeId, widgetId] = requirement.key.split('::');
  return {
    node_id: nodeId,
    widget_id: widgetId ?? null,
    label: requirement.label,
    kind: requirement.kind,
    direction: requirement.direction,
    current_value: requirement.current,
  };
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function body(request: IncomingMessage): Promise<unknown> {
  return new Promise((fulfil, fail) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      try {
        fulfil(raw ? JSON.parse(raw) : {});
      } catch (error) {
        fail(error);
      }
    });
    request.on('error', fail);
  });
}
