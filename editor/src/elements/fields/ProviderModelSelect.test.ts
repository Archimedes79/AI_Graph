import { describe, it, expect } from 'vitest';
import { modelHints, nowText } from './ProviderModelSelect';
import { lent } from '@engine/elements/Runtime.ts';

const status = {
  local: { lmstudio: { reachable: true, models: ['qwen', 'phi'] }, ollama: { reachable: false, models: [] } },
  target: { provider: 'lmstudio', model: 'qwen' },
};

/**
 * What a node's model box says when it is left empty.
 *
 * The engine fills an empty model only from the one AI setting, and only for
 * the provider the setting names; otherwise it refuses. The box used to show
 * the first model a local provider served beside a provider a run would never
 * send it to.
 */
describe('a node\'s model box, left empty', () => {
  it('shows the one setting\'s model for the setting and for its provider', () => {
    expect(modelHints('default', status, { lendsFromSetting: true })).toEqual({ servedModels: ['qwen', 'phi'], placeholder: 'qwen' });
    expect(modelHints('lmstudio', status, { lendsFromSetting: true }).placeholder).toBe('qwen');
  });

  it('asks for a model on another provider, because a run would refuse', () => {
    expect(modelHints('openai', status, { lendsFromSetting: true }).placeholder).toBe('required: name a model');
  });

  it('says the model a run sends, for every provider a node may name', () => {
    for (const provider of ['default', 'lmstudio', 'openai', 'anthropic'] as const) {
      // What the running engine sends for a node on *provider* with no model.
      const sent = lent({ provider, model: '' }, status.target).model;
      const shown = modelHints(provider, status, { lendsFromSetting: true }).placeholder;
      expect(sent ? shown : '', provider).toBe(sent);
    }
  });
});

describe('the one setting\'s own model box, left empty', () => {
  it('shows what the setting resolves to now, or the provider\'s own models', () => {
    expect(modelHints('default', status).placeholder).toBe('qwen');
    expect(modelHints('lmstudio', status).placeholder).toBe('qwen');
    expect(modelHints('openai', status).placeholder).toBe('its default model');
  });
});

describe('"now"', () => {
  it('is what the engine says the setting is, not worked out here', () => {
    expect(nowText(status)).toBe('lmstudio / qwen');
    expect(nowText(null)).toBe('…');
  });
});
