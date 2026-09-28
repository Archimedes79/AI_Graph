import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../../../graph.ts';
import type { AiRequest, Runtime } from '../../Runtime.ts';
import { registry } from '../../registry.ts';
import { nodeCode } from '../../../host/node.ts';
import { quietRuntime } from '../../../../test/fakes.ts';

/**
 * `node.llm`: a body asking the process that holds the keys for a model call.
 *
 * The real sandbox throughout -- what is tested is a body in another process
 * asking this one for a model call, and a fake runner would test nothing.
 */

const port = (id: string, kind: 'input' | 'output') =>
  ({ id, name: id, kind, data_type: 'any' as const, multi: false, required: false, description: '' });

const codeNode = (code: string): GraphNode => ({
  id: 'ask', node_type: 'code', label: 'Ask', description: '', position: { x: 0, y: 0 },
  inputs: [port('text', 'input')], outputs: [port('output', 'output')], config: { code },
});

function recording(reply: (request: AiRequest) => string = () => 'an answer'): Runtime & { asked: AiRequest[] } {
  const asked: AiRequest[] = [];
  return {
    asked,
    ...quietRuntime({ code: nodeCode, ai: { complete: async (request) => { asked.push(request); return reply(request); } } }),
  };
}

const code = registry.node('code')!;

describe('a code node', () => {
  it('may ask a model, on the graph\'s default, and a bundle of it says so', async () => {
    const runtime = recording(() => 'forty-two');
    const node = codeNode('async function run(i, node) { return { output: await node.llm({ prompt: "What is " + i.text + "?" }) }; }');
    expect(await code.execute(node, { text: '6 x 7' }, runtime)).toEqual({ output: 'forty-two' });
    expect(runtime.asked[0]).toMatchObject({ prompt: 'What is 6 x 7?', provider: 'default', system: '' });
    expect(code.deployNeeds(node).asksAi).toBe(true);
  }, 30_000);

  it('may give its own instructions and inputs, sent the way an ai node sends them', async () => {
    const runtime = recording();
    const node = codeNode('async function run(i, node) { return { output: await node.llm({ system: "Be brief.", inputs: { a: "one", b: "two" }, temperature: 0 }) }; }');
    await code.execute(node, { text: 'x' }, runtime);
    expect(runtime.asked[0]).toMatchObject({ system: 'Be brief.', prompt: 'a:\none\n\nb:\ntwo', temperature: 0 });
  }, 30_000);

  it('is told when it has asked as often as it may, instead of spending a budget', async () => {
    const runtime = { ...recording(), llmCallsPerBody: 3 };
    const node = codeNode('async function run(i, node) { for (;;) await node.llm({ prompt: "again" }); }');
    await expect(code.execute(node, { text: 'x' }, runtime)).rejects.toThrow(/asked the model 3 times/);
    expect(runtime.asked).toHaveLength(3);
  }, 30_000);
});
