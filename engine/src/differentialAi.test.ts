import { describe, it, expect, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { parseGraph } from './graph.ts';
import { executeGraph } from './executor.ts';
import { registry } from './registry.ts';
import { nodeFiles, nodeCode } from './host/node.ts';
import { aiService } from './ai/providers.ts';
import { applyRuntimeValues, runtimeRequirements, withDefaults } from './runtimeValues.ts';

/**
 * The AI examples, through both engines, against the same model.
 *
 * A stub returning canned text would only prove that two stubs agree. So this
 * stands up a tiny OpenAI-compatible endpoint on localhost and points *both*
 * engines at it: the whole path is exercised — provider selection, the request
 * body, the reply shape — and the answer is deterministic because the endpoint
 * echoes what it was asked.
 *
 * It is also the closest thing to a real integration test either engine has:
 * an endpoint that speaks this protocol is what LM Studio, Ollama's compat
 * layer and half the self-hosted world are.
 */

const REPO = resolve(__dirname, '..', '..');
const PYTHON = resolve(REPO, '.venv/Scripts/python.exe');

/** An endpoint that answers with a summary of what it was sent. */
function startModel(): Promise<{ url: string; server: Server; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      const user = parsed.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '';
      asked.push(String(user));
      // Deterministic and derived from the prompt, so a mismatch anywhere in
      // the assembly shows up as different text rather than as luck.
      const reply = `summary(${String(user).length} chars)`;

      // Both shapes, because a real endpoint serves both and the two engines
      // ask differently: the Python one streams for progress, this one does
      // not. Answering only JSON made the Python side report "no content",
      // which is what an endpoint that cannot stream looks like from there.
      if (parsed.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const frame = JSON.stringify({ choices: [{ delta: { content: reply } }] });
        response.write(`data: ${frame}\n\n`);
        response.write('data: [DONE]\n\n');
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
  });

  return new Promise((fulfil) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      fulfil({ url: `http://127.0.0.1:${port}/v1`, server, asked });
    });
  });
}

const model = await startModel();
afterAll(() => { model.server.close(); });

const AI_ENV = {
  AI_GRAPH_AI_PROVIDER: 'openai_compatible',
  AI_GRAPH_AI_MODEL: 'stub-model',
  OPENAI_COMPATIBLE_BASE_URL: model.url,
};

function runPython(graphPath: string, values: Record<string, string>): Promise<any> {
  const inputs = Object.entries(values).flatMap(([k, v]) => ['--inputs', `${k}=${v}`]);
  return new Promise((fulfil, fail) => {
    const child = spawn(PYTHON, [resolve(REPO, 'graph-runner/run.py'), graphPath, ...inputs], {
      cwd: REPO,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...AI_ENV },
    });
    let out = ''; let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) return fail(new Error(`run.py exited ${code}:\n${err}`));
      try {
        fulfil(JSON.parse(out));
      } catch {
        fail(new Error(`run.py printed no JSON:\n${out.slice(0, 400)}\n${err.slice(-400)}`));
      }
    });
  });
}

async function runTypeScript(graphPath: string, values: Record<string, string>) {
  const graph = parseGraph(JSON.parse(await readFile(graphPath, 'utf8')));
  applyRuntimeValues(graph, withDefaults(runtimeRequirements(graph, registry), values), registry);
  const runtime = {
    files: nodeFiles,
    code: nodeCode,
    ai: aiService({
      provider: 'openai_compatible',
      model: 'stub-model',
      endpoints: { openai_compatible: model.url },
    }),
  };
  return executeGraph(graph, { runtime, registry });
}

function outputsByNode(result: any): Record<string, unknown> {
  const byNode: Record<string, unknown> = {};
  for (const node of result.node_results ?? []) byNode[node.node_id] = node.outputs;
  return byNode;
}

describe('the two engines agree about asking a model', () => {
  it('summarises each story and then all of them, identically', async () => {
    const path = resolve(REPO, 'examples/text_summary.json');
    const values = { stories: resolve(REPO, 'examples/kurzgeschichten') };

    const [python, typescript] = await Promise.all([
      runPython(path, values), runTypeScript(path, values),
    ]);

    expect(typescript.status).toBe(python.status);
    expect(outputsByNode(typescript)).toEqual(outputsByNode(python));
  }, 240_000);

  it('really called the model, per story and then once more', async () => {
    // Both engines agreeing on "nothing happened" would pass the test above.
    // The per-item node runs once per story and the whole-list node once, so
    // the endpoint must have been asked more than twice.
    expect(model.asked.length).toBeGreaterThan(2);
  });
});
