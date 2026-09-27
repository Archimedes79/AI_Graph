import { describe, it, expect } from 'vitest';
import { editorRoutes } from './routes.ts';
import type { BlockResult } from '../api.ts';

/**
 * A block tried by itself in the editor (▶ Try it under its code), with code
 * that asks a model: it must ask the model a run of the graph asks.
 *
 * A block alone is no graph, so the executor never applied the graph's
 * `ai_defaults` to it, and Try it tested a different model than the run used.
 */

const routes = editorRoutes();
const runBlock = (asked: object) => routes.runBlock!(asked as never, { loopback: true } as never) as Promise<BlockResult>;

const asking = {
  id: 'rows', kind: 'table', label: 'Rows',
  code: 'async function run(inputs, node) { return { value: [{ said: await node.llm({ prompt: "Name a city." }) }] }; }',
};

describe('a block tried by itself', () => {
  it('asks the model the graph names, as a run of the graph does', async () => {
    // A provider nobody has: asked for it, the provider layer refuses by name,
    // before anything leaves the machine. Asked for the machine's default
    // instead, it would say something else, or not fail at all.
    const result = await runBlock({
      widget: asking, value: null,
      metadata: { ai_defaults: { provider: 'no_such_provider', model: 'some-model' } },
    });
    expect(result.status).toBe('success');
    expect(String(result.shown)).toContain('Unknown AI provider: no_such_provider');
  }, 30_000);
});
