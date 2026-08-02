import axios from 'axios';
import type { Graph, ExecutionResult, RuntimeRequirement } from '../types/graph';

const api = axios.create({
  baseURL: '/api',
  timeout: 120_000,
});

// Graph CRUD
export const listGraphs = () => api.get('/graphs/').then((r) => r.data);
export const createGraph = (graph: Graph) => api.post('/graphs/', graph).then((r) => r.data);
export const getGraph = (id: string) => api.get(`/graphs/${id}`).then((r) => r.data);
export const updateGraph = (id: string, graph: Graph) => api.put(`/graphs/${id}`, graph).then((r) => r.data);
export const deleteGraph = (id: string) => api.delete(`/graphs/${id}`).then((r) => r.data);
export const exportGraph = (id: string) => api.get(`/graphs/${id}/export`).then((r) => r.data);

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
  inputs?: string[];
  outputs?: string[];
  ai_model?: string;
  ai_provider?: string;
}) => api.post('/ai/generate-code', body).then((r) => r.data);

export const generatePrompt = (body: {
  description: string;
  context?: string;
  ai_model?: string;
  ai_provider?: string;
}) => api.post('/ai/generate-prompt', body).then((r) => r.data);

export const generateGraph = (body: {
  description: string;
  context?: string;
  ai_model?: string;
  ai_provider?: string;
}): Promise<{ graph: Graph; explanation?: string }> =>
  api.post('/ai/generate-graph', body).then((r) => r.data);

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

export const getRunnerScript = (graph: Graph) =>
  api.post('/deploy/runner-script', graph).then((r) => r.data);

// Files
export const detectFileFormat = (path: string): Promise<{ format: string }> =>
  api.post('/files/detect-format', { path }).then((r) => r.data);
