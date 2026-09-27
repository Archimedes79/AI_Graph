import { describe, it, expect } from 'vitest';
import { modelWhenEmpty } from './ProviderModelSelect';

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
});
