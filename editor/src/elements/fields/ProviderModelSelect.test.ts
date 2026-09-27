import { describe, it, expect } from 'vitest';
import { modelHints, modelWhenEmpty } from './ProviderModelSelect';
import { lent } from '@engine/elements/Runtime.ts';
import { withGraphDefaults } from '@engine/execution/executor.ts';

/**
 * What the model box says when it is left empty, on a picker a run reads.
 *
 * The engine fills an empty model only from a place that names the same
 * provider, and refuses otherwise. The box used to show the first model a
 * local provider served, or the machine's, beside a provider a run would
 * never send it to.
 */
describe('modelWhenEmpty', () => {
  const machine = { provider: 'lmstudio', model: 'qwen' };

  it('is the machine\'s model for the machine\'s own provider, and for the default', () => {
    expect(modelWhenEmpty('lmstudio', [undefined, machine])).toBe('qwen');
    expect(modelWhenEmpty('default', [undefined, machine])).toBe('qwen');
  });

  it('is nothing for another provider: a run refuses, so a model must be named', () => {
    expect(modelWhenEmpty('openai', [undefined, machine])).toBe('');
    expect(modelWhenEmpty('google', [{ provider: 'default', model: '' }, machine])).toBe('');
  });

  it('takes the graph\'s default first, for the provider it names', () => {
    const graph = { provider: 'openai', model: 'gpt-4o-mini' };
    expect(modelWhenEmpty('openai', [graph, machine])).toBe('gpt-4o-mini');
    expect(modelWhenEmpty('default', [graph, machine])).toBe('gpt-4o-mini');
    expect(modelWhenEmpty('lmstudio', [graph, machine])).toBe('qwen');
  });

  it('follows a graph default that names a provider and no model to the machine, only when it is the machine\'s', () => {
    expect(modelWhenEmpty('default', [{ provider: 'lmstudio', model: '' }, machine])).toBe('qwen');
    expect(modelWhenEmpty('default', [{ provider: 'anthropic', model: '' }, machine])).toBe('');
  });

  it('takes the model of a graph default that names no provider, as a run does', () => {
    // The bug: a graph default of "Default" with a model typed beside it was
    // skipped, and the box showed the machine's model while a run sent the
    // graph's to the machine's provider.
    expect(modelWhenEmpty('default', [{ provider: 'default', model: 'llama3.2' }, machine])).toBe('llama3.2');
    expect(modelWhenEmpty('openai', [{ provider: 'default', model: 'llama3.2' }, machine])).toBe('');
  });

  it('says the model a run sends, for every node provider and graph default', async () => {
    const graphs = [undefined, { provider: 'default', model: '' }, { provider: 'default', model: 'g' }, { provider: 'lmstudio', model: '' },
      { provider: 'openai', model: 'gpt' }, { provider: 'openai', model: '' }];
    for (const graph of graphs) {
      for (const provider of ['default', 'lmstudio', 'openai', 'anthropic']) {
        // A run: the graph's default first (`withGraphDefaults`), then the machine's, as `aiService` fills it.
        const sent: string[] = [];
        const machineLayer = { complete: async (request: { provider?: string; model?: string }) => { sent.push(lent(request, machine).model); return ''; } };
        const runtime = withGraphDefaults({ ai: machineLayer } as never, { metadata: { ai_defaults: graph } } as never);
        await runtime.ai.complete({ prompt: '', provider, model: '' });
        expect(modelWhenEmpty(provider, [graph, machine]), `${provider} under ${JSON.stringify(graph)}`).toBe(sent[0]);
      }
    }
  });
});

/**
 * The generation picker's `default` is ✨'s target, which the environment or
 * the file's `codegen` can put elsewhere than a run's. Shown the run's, the box
 * offered a local model while ✨ asked Anthropic.
 */
describe('modelHints', () => {
  const status = {
    local: { lmstudio: { reachable: true, models: ['qwen', 'phi'] }, ollama: { reachable: false, models: [] } },
    runtime_target: { provider: 'lmstudio', model: 'qwen' },
    gen_target: { provider: 'anthropic', model: 'claude-x' },
  };

  it('shows the generation target for the generation picker\'s default', () => {
    expect(modelHints('default', status, { defaultTarget: 'generation' })).toEqual({ servedModels: [], placeholder: 'claude-x' });
  });

  it('shows the runtime target, and what it serves, for everyone else\'s default', () => {
    expect(modelHints('default', status)).toEqual({ servedModels: ['qwen', 'phi'], placeholder: 'qwen' });
  });
});
