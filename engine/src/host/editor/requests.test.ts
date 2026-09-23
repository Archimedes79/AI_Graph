import { describe, it, expect } from 'vitest';
import { editorRoutes } from './routes.ts';
import type { Graph } from '../../graph.ts';

/**
 * What an ai node would ask, shown before anything is sent.
 *
 * The preview in the node's dialog assembles the standard request itself; a
 * run.js someone changed may ask twice, or ask something else entirely, and
 * only running it can say what. So it is run, with a model that makes its
 * answers up and writes the questions down.
 */

const port = (id: string, kind: 'input' | 'output') => ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '' });

function asking(runCode: string): Graph & { node_id: string; inputs: Record<string, unknown> } {
  return {
    metadata: { name: 'Asked' },
    nodes: [{
      id: 'ask', node_type: 'ai', label: 'Ask', description: '', position: { x: 0, y: 0 },
      inputs: [port('topic', 'input')], outputs: [port('output', 'output')],
      config: { system_prompt: 'Be brief.', run_code: runCode },
    }],
    edges: [],
    node_id: 'ask',
    inputs: { topic: 'owls' },
  } as never;
}

const routes = editorRoutes();
const requests = (graph: ReturnType<typeof asking>) => routes.nodeRequests!(graph as never, { loopback: true } as never) as Promise<{ requests: { system: string; prompt: string }[]; error: string | null }>;

describe('what a node would ask', () => {
  it('is the standard request when run.js is as it came', async () => {
    const { requests: asked, error } = await requests(asking(''));
    expect(error).toBeNull();
    expect(asked).toEqual([{ system: 'Be brief.', prompt: 'owls', images: 0 }]);
  });

  it('is every question a changed run.js asks, each answered with a stand-in', async () => {
    const twice = `async function run(inputs, node) {
      const first = await node.llm({ prompt: 'List facts about ' + inputs.topic });
      const second = await node.llm({ prompt: 'Check these: ' + first });
      return { output: second };
    }`;
    const { requests: asked, error } = await requests(asking(twice));
    expect(error).toBeNull();
    expect(asked.map((request) => request.prompt)).toEqual([
      'List facts about owls',
      "Check these: ⟨the model's answer to question 1⟩",
    ]);
  });
});
