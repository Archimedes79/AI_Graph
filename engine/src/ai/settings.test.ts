import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidatePaths, configuredSettings, fromFile } from './settings.ts';

/**
 * A key belongs in a file, not in a terminal on every run — and not in the
 * repository. This is the file, and the rule that an explicit variable still
 * wins over it, so a one-off `AI_GRAPH_AI_MODEL=x` needs no editing.
 */
async function withSettings(contents: string, run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-graph-settings-'));
  try {
    await writeFile(join(dir, 'ai-settings.json'), contents);
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('ai-settings.json', () => {
  it('supplies the provider, the model and the key', async () => {
    await withSettings(
      JSON.stringify({ ai: { provider: 'google', model: 'gemini-2.5-flash' }, api_keys: { google: 'k' } }),
      async (dir) => {
        const settings = fromFile(dir);
        expect(settings.provider).toBe('google');
        expect(settings.model).toBe('gemini-2.5-flash');
        expect(settings.apiKeys).toEqual({ google: 'k' });
      },
    );
  });

  it('lets a set variable win, so one command can differ without an edit', async () => {
    await withSettings(
      JSON.stringify({ ai: { provider: 'google', model: 'gemini-2.5-flash' }, api_keys: { google: 'k' } }),
      async (dir) => {
        const settings = configuredSettings({ AI_GRAPH_AI_MODEL: 'gemini-2.5-pro' }, dir);
        expect(settings.model).toBe('gemini-2.5-pro');
        // and the key from the file survives, rather than the variable
        // replacing the whole configuration
        expect(settings.apiKeys).toEqual({ google: 'k' });
      },
    );
  });

  it('ignores a file someone is halfway through editing', async () => {
    // A run that needs no model at all should not fail over a stray comma.
    await withSettings('{ "ai": { "provider": ', async (dir) => {
      expect(fromFile(dir)).toEqual({});
    });
  });

  it('is nothing at all when there is no file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-empty-'));
    try {
      // Named outright, so the search cannot fall through to a real settings
      // file on this machine -- which is how this test used to pass by luck,
      // and how it started reading a developer's own key when one appeared
      // beside the engine.
      const env = { AI_GRAPH_SETTINGS: join(dir, 'ai-settings.json') };
      expect(fromFile(dir, env)).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the named file and only that one, even before it exists', async () => {
    // `save()` has to land where the variable says, or the first write goes
    // somewhere else than every read after it.
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-named-'));
    try {
      const named = join(dir, 'elsewhere.json');
      expect(candidatePaths(dir, { AI_GRAPH_SETTINGS: named })).toEqual([named]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
