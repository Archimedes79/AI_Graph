import axios from 'axios';
import type { Graph, ExecutionResult, RuntimeRequirement } from '../types/graph';

// Must stay above backend AI_COMPLETE_TIMEOUT (ai_service.py) so the client
// never times out before a slow local model (up to ~10 min) responds.
const api = axios.create({
  baseURL: '/api',
  timeout: 660_000,
});

// File-based Load/Save (New/Load/Save/Save As), reading and writing an absolute
// server-side path so repeated saves round-trip to the same file it was loaded from.
export const loadGraphFile = (path: string): Promise<{ path: string; graph: Graph }> =>
  api.post('/graphs/file/load', { path }).then((r) => r.data);

// Returns the graph as written: saving renames a node's file to follow its
// label, so `config.code_file` can come back different from what was sent.
export const saveGraphFile = (path: string, graph: Graph): Promise<{ path: string; graph: Graph }> =>
  api.post('/graphs/file/save', { path, graph }).then((r) => r.data);

// Re-read the node files of an already-open graph. Only needed for the case the
// conflict check exists for: edited outside while the editor was open.
export const reloadNodeFiles = (path: string): Promise<{ path: string; graph: Graph }> =>
  api.post('/graphs/file/reload-nodes', { path }).then((r) => r.data);

// Execution
export const getRuntimeRequirements = (graph: Graph): Promise<RuntimeRequirement[]> =>
  api.post('/execute/requirements', graph).then((r) => r.data);

// AI generation
/**
 * What running the generated code against real data revealed. `skipped` means
 * no sample was sent, so generation was a single pass -- see
 * backend/app/services/code_refine.py.
 */
export interface CodeProbeReport {
  status: 'skipped' | 'ok' | 'repaired' | 'failed';
  attempts: number;
  error: string;
  missing_outputs: string[];
  output_preview: string;
  /** What the code actually returned, whole: the next node's sample, not a peek at it. */
  outputs?: Record<string, unknown>;
}

/**
 * One request to a model, as it happened.
 *
 * For looking at, not for acting on. Generation is a black box otherwise —
 * press the button, wait, get text or an error — and when the error says the
 * context window may be overloaded there is no way to check that against what
 * was actually sent. Code generation is not even one call: it generates, runs
 * the result against real inputs, and repairs it.
 */
export interface AICall {
  provider: string;
  model: string;
  system: string;
  prompt: string;
  /** Counted on the server, so the number has one source rather than one per client. */
  sent_chars: number;
  reply: string | null;
  reply_chars: number;
  seconds: number;
  error: string | null;
}

/** What one generation returns, whichever element asked -- see GenerateResponse. */
export interface GenerationResult {
  /** The generated text. Which field it belongs in is the caller's own business. */
  result: string;
  explanation?: string;
  probe: CodeProbeReport;
  /** Every model call this generation made, in order. */
  calls?: AICall[];
}

/**
 * Generate one element's authored text.
 *
 * `element` is a NodeType or GuiWidgetKind: the server looks up that element's
 * `Generation` descriptor and takes the generator kind, the contract sentence
 * and any fixed port names from it, so none of those travel from here. `kind`
 * is for the one generation that belongs to no element -- the output-format
 * description, which asks the same question of an ai and a code node.
 */
export const generate = (body: {
  element?: string;
  kind?: string;
  description: string;
  context?: string;
  context_file?: string;
  inputs?: string[];
  outputs?: string[];
  /** Real port values from the last run; enables the verify-and-repair pass. */
  sample_inputs?: Record<string, unknown>;
  input_sources?: Record<string, string>;
  ai_model?: string;
  ai_provider?: string;
  /** Lets the editor watch this generation's transcript while it runs. */
  progress_id?: string;
}): Promise<GenerationResult> => api.post('/ai/generate', body).then((r) => r.data);

/** What the generation with this id has sent and received so far. */
export const getGenerationProgress = (id: string): Promise<{ calls: AICall[]; done: boolean }> =>
  api.get('/ai/generate/progress', { params: { id } }).then((r) => r.data);

export const generateGraph = (body: {
  description: string;
  context?: string;
  ai_model?: string;
  ai_provider?: string;
}): Promise<{ graph: Graph; explanation?: string }> =>
  api.post('/ai/generate-graph', body).then((r) => r.data);

// Deployed-runtime endpoints (served by a deploy bundle's serve.py, not by the
// editor backend): the one graph the bundle ships, and the AI configuration
// whoever runs it can change without touching the graph.
export const getRuntimeGraph = (): Promise<Graph> =>
  api.get('/runtime/graph').then((r) => r.data);

export interface ProviderStatus {
  local: Record<string, { reachable: boolean; models: string[] }>;
  runtime_target: { provider: string; model: string };
  gen_target: { provider: string; model: string };
}

export const getProviderStatus = (): Promise<ProviderStatus> =>
  api.get('/ai/providers').then((r) => r.data);

export interface RuntimeAISettingsPayload {
  settings: { ai?: { provider?: string; model?: string } };
  effective: { provider: string; model: string; settings_file: string };
  base_url: string;
  api_key: string;
}

export const getAISettings = (): Promise<RuntimeAISettingsPayload> =>
  api.get('/runtime/ai-settings').then((r) => r.data);

export const saveAISettings = (
  body: { provider: string; model: string; base_url: string; api_key: string },
): Promise<{ path: string; effective: RuntimeAISettingsPayload['effective'] }> =>
  api.post('/runtime/ai-settings', body).then((r) => r.data);

// Server-side directory listing for the file/directory pickers. A browser never
// reveals a chosen file's real location, and the engine resolves real paths, so
// a picker has to browse the machine the graph runs on. The deployed runtime
// (graph-runner/serve.py) serves this same route on a loopback bind.
export const browseDirectory = (
  path: string,
  extensions?: string,
): Promise<{ path: string; parent: string | null; entries: { name: string; path: string; is_dir: boolean }[]; roots: string[] }> =>
  api.post('/files/browse', { path, extensions: extensions || '' }).then((r) => r.data);

// Example-input attachments (stored project-side, referenced by an element's
// `example_file`). Keeps the config a plain server path, like any other file field.
export const uploadAttachment = (file: File): Promise<{ path: string; name: string }> =>
  api.post('/files/attachments', file, {
    params: { name: file.name },
    headers: { 'Content-Type': 'application/octet-stream' },
  }).then((r) => r.data);

export const deleteAttachment = (path: string): Promise<void> =>
  api.delete('/files/attachments', { params: { path } }).then(() => undefined);

// Deployment
export const downloadBundle = async (graph: Graph) => {
  const response = await api.post('/deploy/bundle', graph, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${graph.metadata.name.toLowerCase().replace(/\s+/g, '_')}_bundle.zip`;
  a.click();
  URL.revokeObjectURL(url);
};

// Files
export const detectFileFormat = (path: string): Promise<{ format: string }> =>
  api.post('/files/detect-format', { path }).then((r) => r.data);

// AI credentials and endpoints for the editor's Settings dialog. Keys are write-
// only: the server reports whether one is set and where it came from, never its
// value (see routers/ai.py).
export interface AISettingsStatus {
  settings_file: string;
  settings_file_exists: boolean;
  endpoints: Record<string, string>;
  credentials: Record<string, { configured: boolean; source: string }>;
}

export const getEditorAISettings = (): Promise<AISettingsStatus> =>
  api.get('/ai/settings').then((r) => r.data);

export const saveEditorAISettings = (body: {
  endpoints?: Record<string, string>;
  api_keys?: Record<string, string>;
  clear_keys?: string[];
}): Promise<AISettingsStatus> => api.post('/ai/settings', body).then((r) => r.data);

// Watchable, stoppable runs. POST /execute/ still exists for scripts that want
// one blocking call; the editor and the deployed runtime page use these so they
// can show which node is busy and offer a Stop button.
export interface RunSnapshot {
  run_id: string;
  done: boolean;
  cancelled: boolean;
  completed: number;
  total: number;
  running: string[];
  current_label: string;
  // Progress *within* the node in flight. `completed/total` counts nodes, which
  // does not move at all while one node grinds through a 500-item batch or a
  // single long streaming call -- the two cases that look exactly like a hang.
  item_done: number;
  item_total: number;
  /** Seconds since the running node last showed life; null before anything reported. */
  idle_seconds: number | null;
  error: string | null;
  result: ExecutionResult | null;
}

export const startRun = (graph: Graph): Promise<{ run_id: string; total: number }> =>
  api.post('/execute/start', graph).then((r) => r.data);

export const getRunSnapshot = (runId: string): Promise<RunSnapshot> =>
  api.get(`/execute/runs/${runId}`).then((r) => r.data);

export const cancelRun = (runId: string): Promise<{ cancelled: boolean }> =>
  api.post(`/execute/runs/${runId}/cancel`).then((r) => r.data);

