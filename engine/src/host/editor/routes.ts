// What the server answers only while a graph is being built.
//
// The `editor` rows of the table in `api.ts`. Loaded by `serve.ts` with a
// dynamic import when it is the editor, and never otherwise -- this folder is
// not in a bundle, so a deployed tool cannot answer these even by mistake.
//
// Each handler takes the request the table promises and returns its response;
// a refusal is thrown as a `Refusal` with its status. What the handlers do is
// done elsewhere: running by the executor, files by `files.ts`, the project by
// `project/folder.ts`, generation by `generate.ts`, settings by `settings.ts`.

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGraph, type Graph } from '../../graph.ts';
import { executeNode, inputsFor } from '../../execution/executor.ts';
import { LastOutputs } from '../../execution/reuse.ts';
import { runExample } from '../../authoring/examples.ts';
import { registry } from '../../elements/registry.ts';
import { writeBundle } from '../../cli/bundle.ts';
import { zipMode } from '../../cli/launchers.ts';
import { applyRuntimeValues } from '../../execution/runtimeValues.ts';
import { nodeRuntime } from '../node.ts';
import { aiSetting } from '../../ai/settings.ts';
import { Download, Refusal, message, type Handlers } from '../http.ts';
import type { AICall, GraphFile } from '../api.ts';
import * as files from './files.ts';
import { NotAGraph, NotFound } from '../../errors.ts';
import * as settings from './settings.ts';
import * as project from '../../project/folder.ts';
import * as gen from './generate.ts';
import { zip } from './zip.ts';

/** The built editor, when this checkout has one: a bundle from the editor carries the same page `--bundle` does. */
const BUILT_PAGE = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..', 'editor', 'dist');

/**
 * @param held the graph this server serves as a tool — see `holdGraph`. The
 *   editor's own server starts with none; the page puts one there.
 */
export function editorRoutes(held: { graph: Graph | null } = { graph: null }): Handlers {
  // Asking what arrives at a node, again and again while writing it, need not
  // ask the model upstream again each time when nothing there has changed.
  const reuse = new LastOutputs();
  /**
   * Transcripts of generations still in flight, by the id the page sent.
   *
   * The array is the one `generate` is writing into, so a poll sees the prompt
   * and each step as they happen. Dropped when the generation ends: the reply
   * carries the final transcript.
   */
  const generating = new Map<string, AICall[]>();

  /** Run *work* with a transcript the page can watch under *id*, and keep it on a failure. */
  async function watched<T>(id: string | undefined, work: (calls: AICall[]) => Promise<T>): Promise<T> {
    // Registered before the first call, so an early poll sees an empty
    // transcript rather than a 'not found' it would have to interpret.
    const calls: AICall[] = [];
    if (id) generating.set(id, calls);
    try {
      return await work(calls);
    } catch (error) {
      if (error instanceof gen.GenerationRefused) throw new Refusal(400, error.message);
      // The failing generation is the one whose transcript is worth reading.
      const failed = error instanceof gen.GenerationFailed ? error.calls : calls;
      throw new Refusal(500, message(error), { calls: failed });
    } finally {
      if (id) generating.delete(id);
    }
  }

  /** Open (and so Reload) and Save, with the project layer's refusals as the statuses the page reads. */
  async function onFile(path: string, action: string, work: (path: string) => Promise<GraphFile['graph']>): Promise<GraphFile> {
    if (!path) throw new Refusal(400, "Missing required field 'path'");
    const full = resolve(expandHome(path));
    try {
      const graph = await work(full);
      const folder = project.projectFolderOf(full);
      return { path: folder ?? full, graph, project: folder !== null };
    } catch (error) {
      if (error instanceof NotFound) throw new Refusal(404, error.message);
      if (error instanceof NotAGraph) throw new Refusal(400, error.message);
      if (error instanceof project.FileChanged) throw new Refusal(409, error.message);
      throw new Refusal(400, `Could not ${action} graph file: ${message(error)}`);
    }
  }

  return {
    runNode: (asked) => executeNode(
      parseGraph(asked), String(asked.node_id ?? ''), asked.inputs ?? {}, { runtime: nodeRuntime(), registry },
    ),

    testNode: (asked) => runExample(parseGraph(asked), String(asked.node_id ?? ''), { runtime: nodeRuntime(), registry }),

    async nodeInputs(asked) {
      const graph = parseGraph(asked);
      applyRuntimeValues(graph, {}, registry);
      const { inputs, upstream } = await inputsFor(graph, String(asked.node_id ?? ''), { runtime: nodeRuntime(), registry, reuse });
      const failed = upstream.node_results.find((result) => result.status === 'error');
      return { inputs, error: failed ? `${failed.node_id}: ${failed.error}` : null };
    },

    openGraph: (asked) => onFile(asked.path, 'load', (path) => project.loadGraph(path)),
    saveGraph: (asked) => onFile(asked.path, 'save', async (path) => {
      const graph = parseGraph(asked.graph);
      await project.saveGraph(path, graph);
      return graph;
    }),

    findProjects: async (asked, { loopback }) => {
      if (!loopback) throw new Refusal(403, 'Looking for projects is only offered on this machine.');
      return { paths: asked.name ? await files.findProjects(String(asked.name)) : [], searched: files.fileSearch() };
    },

    findFile: async (asked, { loopback }) => {
      if (!loopback) throw new Refusal(403, 'Looking for files is only offered on this machine.');
      const size = Number(asked.size);
      return {
        paths: asked.name && Number.isFinite(size) ? await files.findFiles(String(asked.name), size) : [],
        searched: files.fileSearch(),
      };
    },

    async projectChanges(asked) {
      const folder = asked.path ? project.projectFolderOf(resolve(expandHome(asked.path))) : null;
      if (!folder) return { changes: [] };
      try {
        return { changes: await project.changesOnDisk(folder) };
      } catch (error) {
        // Half-written by another editor, most likely: asked again in a moment.
        throw new Refusal(409, message(error));
      }
    },

    generate: (asked) => watched(asked.progress_id, async (calls) => {
      const runtime = nodeRuntime();
      return gen.generate(asked, {
        ai: runtime.ai,
        code: runtime.code,
        files: runtime.files,
        elements: registry,
        target: await aiSetting(),
        calls,
      });
    }),

    // Whether it ended is the generate call's own answer arriving, not this.
    generationProgress: (asked) => ({ calls: generating.get(asked.id) ?? [] }),

    generateGraph: (asked) => watched(asked.progress_id, async (calls) => {
      const target = await aiSetting();
      const current = asked.graph ? parseGraph(asked.graph) : undefined;
      const { graph, explanation } = await gen.generateGraph(asked.description ?? '', { ai: nodeRuntime().ai, target, calls }, current);
      return { graph: parseGraph(graph), explanation };
    }),

    async bundle(asked) {
      const graph = parseGraph(asked);
      const work = await mkdtemp(join(tmpdir(), 'ai-graph-bundle-'));
      try {
        const pageDir = existsSync(join(BUILT_PAGE, 'runtime.html')) ? BUILT_PAGE : undefined;
        await writeBundle(graph, work, { pageDir });
        const entries = [];
        for (const file of await allFiles(work)) {
          const path = file.slice(work.length + 1);
          entries.push({ path, content: await readFile(file), mode: zipMode(path) });
        }
        const name = (graph.metadata.name || 'graph').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'graph';
        return new Download(zip(entries), `${name}_bundle.zip`, 'application/zip');
      } catch (error) {
        throw new Refusal(500, `The engine could not write the bundle: ${message(error)}`);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    },

    // What "open it as a tool" costs: one graph, kept. The runtime page then
    // asks for it over the `graph` route like any deployed page does, so
    // nothing about the delivered side knows it is being previewed.
    holdGraph(asked) {
      held.graph = parseGraph(asked);
      return { ok: true };
    },

    aiSettings: () => settings.status(),

    async saveAiSettings(asked) {
      try {
        return await settings.save(asked);
      } catch (error) {
        throw new Refusal(500, `Could not write ${settings.settingsPath()}: ${message(error)}`);
      }
    },

    providers: () => settings.providerStatus(),

    async openExternal(asked, { loopback }) {
      if (!loopback) throw new Refusal(403, 'Opening files is only offered on this machine.');
      if (!asked.graph_path || !asked.node_id) throw new Refusal(400, "Missing 'graph_path' or 'node_id'.");
      try {
        const folder = project.projectFolderOf(resolve(expandHome(asked.graph_path)));
        if (!folder) throw new Refusal(400, 'Only a project folder keeps files to open: save the graph as one first.');
        const file = await project.nodeFileOf(folder, asked.node_id, asked.file || undefined);
        return await files.openExternal(folder, file);
      } catch (error) {
        if (error instanceof Refusal) throw error;
        throw new Refusal(error instanceof NotFound ? 404 : 400, message(error));
      }
    },
  };
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
