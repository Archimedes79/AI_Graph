import axios from 'axios';
import type { Graph, ExecutionResult, RuntimeRequirement } from '../types/graph';

// Must stay above backend AI_COMPLETE_TIMEOUT (ai_service.py) so the client
// never times out before a slow local model (up to ~10 min) responds.
const api = axios.create({
  baseURL: '/api',
  timeout: 660_000,
});

// Graph CRUD
export const listGraphs = () => api.get('/graphs/').then((r) => r.data);
export const createGraph = (graph: Graph) => api.post('/graphs/', graph).then((r) => r.data);
export const getGraph = (id: string) => api.get(`/graphs/${id}`).then((r) => r.data);
export const updateGraph = (id: string, graph: Graph) => api.put(`/graphs/${id}`, graph).then((r) => r.data);
export const deleteGraph = (id: string) => api.delete(`/graphs/${id}`).then((r) => r.data);
export const exportGraph = (id: string) => api.get(`/graphs/${id}/export`).then((r) => r.data);

// File-based Load/Save (New/Load/Save/Save As), reading and writing an absolute
// server-side path so repeated saves round-trip to the same file it was loaded from.
export const loadGraphFile = (path: string): Promise<{ path: string; graph: Graph }> =>
  api.post('/graphs/file/load', { path }).then((r) => r.data);

export const saveGraphFile = (path: string, graph: Graph): Promise<{ path: string }> =>
  api.post('/graphs/file/save', { path, graph }).then((r) => r.data);

// Execution
export const executeGraph = (graph: Graph): Promise<ExecutionResult> =>
  api.post('/execute/', graph).then((r) => r.data);

export const getRuntimeRequirements = (graph: Graph): Promise<RuntimeRequirement[]> =>
  api.post('/execute/requirements', graph).then((r) => r.data);

// AI generation
export const generateCode = (body: {
  description: string;
  language?: string;
  context?: string;
  context_file?: string;
  inputs?: string[];
  outputs?: string[];
  ai_model?: string;
  ai_provider?: string;
}) => api.post('/ai/generate-code', body).then((r) => r.data);

export const generatePrompt = (body: {
  description: string;
  context?: string;
  context_file?: string;
  ai_model?: string;
  ai_provider?: string;
}) => api.post('/ai/generate-prompt', body).then((r) => r.data);

export const generateOutputFormat = (body: {
  description: string;
  context?: string;
  context_file?: string;
  ai_model?: string;
  ai_provider?: string;
}): Promise<{ output_format_prompt: string; explanation?: string }> =>
  api.post('/ai/generate-output-format', body).then((r) => r.data);

export const generateDataFormat = (body: {
  description: string;
  context?: string;
  context_file?: string;
  ai_model?: string;
  ai_provider?: string;
}): Promise<{ output_format_prompt: string; explanation?: string }> =>
  api.post('/ai/generate-data-format', body).then((r) => r.data);

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

// Context-file attachments (stored project-side, referenced by config_context_file /
// output_context_file). Keeps the config a plain server path, same as any other file field.
export const uploadAttachment = (file: File): Promise<{ path: string; name: string }> => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/files/attachments', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then((r) => r.data);
};

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

export const getDockerCompose = (graph: Graph) =>
  api.post('/deploy/docker-compose', graph).then((r) => r.data);

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
  error: string | null;
  result: ExecutionResult | null;
}

export const startRun = (graph: Graph): Promise<{ run_id: string; total: number }> =>
  api.post('/execute/start', graph).then((r) => r.data);

export const getRunSnapshot = (runId: string): Promise<RunSnapshot> =>
  api.get(`/execute/runs/${runId}`).then((r) => r.data);

export const cancelRun = (runId: string): Promise<{ cancelled: boolean }> =>
  api.post(`/execute/runs/${runId}/cancel`).then((r) => r.data);
