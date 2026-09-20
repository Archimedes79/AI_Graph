import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGraph, type GraphNode } from '../../../graph.ts';
import type { AiRequest, Runtime } from '../../Runtime.ts';
import { registry } from '../../registry.ts';
import { nodeCode } from '../../../host/node.ts';
import { loadGraph, saveGraph } from '../../../project/folder.ts';
import { AiNodeElement } from './AiNodeElement.ts';
import { llmCall } from './ask.ts';
import { AI_RUN, isStandardRun } from './runTemplate.ts';

/**
 * `run.js`: what an ai node does, as a file in its folder.
 *
 * The real sandbox throughout -- what is tested is a body in another process
 * asking this one for a model call, and a fake runner would test nothing.
 */

const port = (id: string, kind: 'input' | 'output') =>
  ({ id, name: id, kind, data_type: 'any' as const, multi: false, required: false, description: '' });

function aiNode(config: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'say', node_type: 'ai', label: 'Say', description: '', position: { x: 0, y: 0 },
    inputs: [port('text', 'input'), port('length', 'input')], outputs: [port('output', 'output')],
    config: {
      system_prompt: 'You summarize.', prompt_template: 'Length: {{length}}\n\n{{text}}',
      ai_provider: 'default', ai_model: 'm', temperature: 0.2, ...config,
    },
  };
}

function recording(reply: (request: AiRequest) => string = () => 'an answer'): Runtime & { asked: AiRequest[] } {
  const asked: AiRequest[] = [];
  return {
    asked,
    files: { read: async () => '', write: async () => {}, list: async () => [], resolve: (p) => p, exists: async () => true },
    code: nodeCode,
    ai: { complete: async (request) => { asked.push(request); return reply(request); } },
  };
}

const INPUTS = { length: 'short', text: 'A long story.' };
const element = new AiNodeElement();

describe('the standard run.js', () => {
  it('is one call, and the engine making it itself asks exactly what the file would', async () => {
    const direct = recording();
    expect(await element.execute(aiNode(), INPUTS, direct)).toEqual({ output: 'an answer' });

    // The same text, run for real where a body runs.
    const viaFile = recording();
    const node = aiNode();
    const settings = element.config(node);
    const out = await nodeCode.run(AI_RUN, INPUTS, undefined, {
      data: { texts: { system: settings.systemPrompt, message: settings.template } },
      calls: { llm: llmCall(settings, viaFile, node.inputs.map((p) => p.id)) },
    });
    expect(out).toEqual({ output: 'an answer' });
    expect(viaFile.asked).toEqual(direct.asked);
    expect(direct.asked[0]).toMatchObject({ system: 'You summarize.', prompt: 'Length: short\n\nA long story.', temperature: 0.2 });
  }, 30_000);

  it('is nobody\'s own, whatever line endings it was saved with', () => {
    expect(isStandardRun('')).toBe(true);
    expect(isStandardRun(`${AI_RUN.replace(/\n/g, '\r\n')}\r\n`)).toBe(true);
    expect(isStandardRun(AI_RUN.replace('const output', 'const answer'))).toBe(false);
    expect(element.config(aiNode({ run_code: AI_RUN })).runCode).toBe('');
  });
});

describe('a run.js of one\'s own', () => {
  const TWICE = `async function run(inputs, node) {
  const draft = await node.llm({ system: node.texts.system, message: node.texts.message, inputs });
  const checked = await node.llm({ prompt: 'Shorten: ' + draft, temperature: 0 });
  return { output: checked };
}`;

  it('runs as a body, and asks for each of its calls', async () => {
    const runtime = recording((request) => (request.prompt.startsWith('Shorten') ? 'short' : 'a draft'));
    expect(await element.execute(aiNode({ run_code: TWICE }), INPUTS, runtime)).toEqual({ output: 'short' });
    expect(runtime.asked.map((request) => request.prompt)).toEqual(['Length: short\n\nA long story.', 'Shorten: a draft']);
    // What the call does not say, the node's settings do.
    expect(runtime.asked[1]).toMatchObject({ system: 'You summarize.', temperature: 0, model: 'm' });
  }, 30_000);

  it('is told when it has asked as often as it may, instead of spending a budget', async () => {
    const LOOP = 'async function run(i, node) { for (;;) await node.llm({ prompt: "again" }); }';
    const runtime = { ...recording(), llmCallsPerBody: 3 };
    await expect(element.execute(aiNode({ run_code: LOOP }), INPUTS, runtime)).rejects.toThrow(/asked the model 3 times/);
    expect(runtime.asked).toHaveLength(3);
  }, 30_000);
});

describe('a code node', () => {
  it('may ask a model too, on the graph\'s default', async () => {
    const runtime = recording(() => 'forty-two');
    const code = registry.node('code')!;
    const node = {
      ...aiNode(), node_type: 'code' as const,
      config: { code: 'async function run(i, node) { return { output: await node.llm({ prompt: "What is " + i.text + "?" }) }; }' },
    };
    expect(await code.execute(node, { text: '6 x 7' }, runtime)).toEqual({ output: 'forty-two' });
    expect(runtime.asked[0]).toMatchObject({ prompt: 'What is 6 x 7?', provider: 'default' });
    expect(code.deployNeeds(node).asksAi).toBe(true);
  }, 30_000);
});

describe('in a project folder', () => {
  it('is written beside the prompts though nobody wrote it, and is not read back as a setting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runjs-'));
    await saveGraph(dir, parseGraph({ metadata: { name: 'p' }, nodes: [aiNode()], edges: [] }));
    expect((await readFile(join(dir, 'nodes', 'say', 'run.js'), 'utf8')).trim()).toBe(AI_RUN);
    expect((await loadGraph(dir)).nodes[0].config.run_code).toBeUndefined();
  });

  it('keeps one that was changed, and runs it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runjs-'));
    await saveGraph(dir, parseGraph({ metadata: { name: 'p' }, nodes: [aiNode()], edges: [] }));
    const mine = AI_RUN.replace('return { output };', 'return { output: output.toUpperCase() };');
    await writeFile(join(dir, 'nodes', 'say', 'run.js'), mine);
    const loaded = await loadGraph(dir);
    expect(loaded.nodes[0].config.run_code).toBe(mine);
    expect(await element.execute(loaded.nodes[0], INPUTS, recording())).toEqual({ output: 'AN ANSWER' });
    await saveGraph(dir, loaded);
    expect((await readFile(join(dir, 'nodes', 'say', 'run.js'), 'utf8')).trim()).toBe(mine);
  }, 30_000);
});
