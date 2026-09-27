import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorRoutes } from './routes.ts';
import { nodeRuntime } from '../node.ts';
import { executeGraph } from '../../execution/executor.ts';
import { registry } from '../../elements/registry.ts';
import type { GraphNode } from '../../graph.ts';
import { graphOf } from '../../../test/fakes.ts';

/**
 * Where an AI call goes, whoever makes it: to the node's own provider and
 * model when it pins them, and to the one AI setting otherwise -- for a run,
 * ✨ Generate and ▶ Try alike.
 *
 * Both are providers nobody has, so the provider layer refuses each by name
 * before anything leaves the machine, and the refusal says where the call
 * went.
 */

const SETTING = 'the_one_setting';
const PIN = 'the_nodes_own';
let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ai-graph-one-setting-'));
  const file = join(dir, 'ai-settings.json');
  await writeFile(file, JSON.stringify({
    ai: { provider: SETTING, model: 'm' },
  }));
  vi.stubEnv('AI_GRAPH_SETTINGS', file);
  // The developer's own shell must not decide this either.
  vi.stubEnv('AI_GRAPH_AI_PROVIDER', '');
  vi.stubEnv('AI_GRAPH_AI_MODEL', '');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const routes = editorRoutes();
const loopback = { loopback: true } as never;
const refusedBy = (provider: string) => `Unknown AI provider: ${provider}`;

function asking(config: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'ask', node_type: 'ai', label: 'Ask', description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [],
    config: { prompt: 'Name a city.', ...config },
  };
}

const onSetting = asking({ ai_provider: 'default', ai_model: '' });
const pinned = asking({ ai_provider: PIN, ai_model: 'its-model' });

describe('a node that pins its own model', () => {
  it('is sent there by a run, and by ▶ Try on its example', async () => {
    const run = await executeGraph(graphOf([pinned]), { runtime: nodeRuntime(), registry });
    expect(run.node_results[0].error).toContain(refusedBy(PIN));

    const tried = await routes.runNode!({ ...graphOf([pinned]), node_id: 'ask', inputs: {} } as never, loopback);
    expect((tried as { error: string }).error).toContain(refusedBy(PIN));

    const tested = await routes.testNode!({
      ...graphOf([asking({ ai_provider: PIN, ai_model: 'its-model', input_definition: 'module.exports = {};' })]),
      node_id: 'ask',
    } as never, loopback);
    expect(JSON.stringify(tested)).toContain(refusedBy(PIN));
  }, 30_000);
});

describe('everything else', () => {
  it('goes to the one AI setting in a run, and in ▶ Try on its example', async () => {
    const run = await executeGraph(graphOf([onSetting]), { runtime: nodeRuntime(), registry });
    expect(run.node_results[0].error).toContain(refusedBy(SETTING));

    const tried = await routes.runNode!({ ...graphOf([onSetting]), node_id: 'ask', inputs: {} } as never, loopback);
    expect((tried as { error: string }).error).toContain(refusedBy(SETTING));

    const tested = await routes.testNode!({
      ...graphOf([asking({ input_definition: 'module.exports = {};' })]),
      node_id: 'ask',
    } as never, loopback);
    expect(JSON.stringify(tested)).toContain(refusedBy(SETTING));
  }, 30_000);

  it('goes there from ✨ Generate', async () => {
    const node = { id: 'count', node_type: 'code', label: 'Count', description: 'Count the words.', inputs: [], outputs: [], config: {} };
    await expect(routes.generate!({ node } as never, loopback))
      .rejects.toThrow(refusedBy(SETTING));
    await expect(routes.generateGraph!({ description: 'Count the words in a text.' } as never, loopback))
      .rejects.toThrow(refusedBy(SETTING));
  }, 30_000);

  it('is what the editor is told it is now', async () => {
    const status = await routes.providers!(undefined as never, loopback);
    expect((status as { target: unknown }).target).toEqual({ provider: SETTING, model: 'm' });
  }, 30_000);
});
