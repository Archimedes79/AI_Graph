import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generationTarget, save, settingsPath, status } from './settings.ts';
import { readSettingsFile } from '../../ai/settings.ts';

/**
 * The settings dialog's contract: what it may see, what a save may change, and
 * where a request ends up when nobody named a model.
 *
 * Every test names its own file through AI_GRAPH_SETTINGS and an empty
 * environment, so nothing here can read the developer's real keys or write
 * into their real file -- the way a test once did in the Python half.
 */

async function own(contents?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-settings-'));
  const file = join(dir, 'ai-settings.json');
  if (contents !== undefined) await writeFile(file, JSON.stringify(contents));
  const env = { AI_GRAPH_SETTINGS: file } as Record<string, string | undefined>;
  return { file, env, dir };
}

describe('what the dialog sees', () => {
  it('reports endpoints and whether a key is set, never the key', async () => {
    const { file, env } = await own({
      endpoints: { lmstudio: 'http://box:1234/v1' },
      api_keys: { openai: 'sk-secret' },
    });
    const seen = status('/nowhere', env);
    expect(seen.settings_file).toBe(file);
    expect(seen.endpoints.lmstudio).toBe('http://box:1234/v1');
    expect(seen.credentials.openai).toEqual({ configured: true, source: 'settings file' });
    expect(seen.credentials.anthropic).toEqual({ configured: false, source: '' });
    expect(JSON.stringify(seen)).not.toContain('sk-secret');
  });

  it('counts a key from the environment as configured, and says so', async () => {
    const { env } = await own();
    const seen = status('/nowhere', { ...env, ANTHROPIC_API_KEY: 'from-env' });
    expect(seen.credentials.anthropic).toEqual({ configured: true, source: 'environment' });
  });

  it('names the file it would create when none exists yet', async () => {
    const { file, env } = await own();
    expect(settingsPath('/nowhere', env)).toBe(file);
    expect(status('/nowhere', env).settings_file_exists).toBe(false);
  });
});

describe('what a save may change', () => {
  it('merges: one provider\'s key never clears another\'s', async () => {
    const { file, env } = await own({ api_keys: { openai: 'keep-me' } });
    await save({ api_keys: { anthropic: 'new' } }, '/nowhere', env);
    expect(readSettingsFile(file).api_keys).toEqual({ openai: 'keep-me', anthropic: 'new' });
  });

  it('treats a blank key as "leave alone", and a clear as a clear', async () => {
    const { file, env } = await own({ api_keys: { openai: 'keep-me', google: 'drop-me' } });
    await save({ api_keys: { openai: '' }, clear_keys: ['google'] }, '/nowhere', env);
    expect(readSettingsFile(file).api_keys).toEqual({ openai: 'keep-me' });
  });

  it('writes endpoints under the provider name', async () => {
    const { file, env } = await own({ endpoints: { ollama: 'http://old:11434' } });
    await save({ endpoints: { lmstudio: 'http://box:1234/v1' } }, '/nowhere', env);
    const raw = JSON.parse(await readFile(file, 'utf8'));
    expect(raw.endpoints).toEqual({ ollama: 'http://old:11434', lmstudio: 'http://box:1234/v1' });
  });

  it('creates the file, and its folder, on first save', async () => {
    const { dir, env } = await own();
    const nested = join(dir, 'deep', 'ai-settings.json');
    const seen = await save({ endpoints: { ollama: 'http://x' } }, '/nowhere', { AI_GRAPH_SETTINGS: nested });
    expect(seen.settings_file_exists).toBe(true);
  });
});

describe('which AI writes the code', () => {
  it('takes what the editor sent, before anything configured', async () => {
    const { env } = await own({ codegen: { provider: 'openai', model: 'gpt-4o-mini' } });
    expect(await generationTarget('anthropic', 'claude-opus-5', '/nowhere', env))
      .toEqual({ provider: 'anthropic', model: 'claude-opus-5' });
  });

  it('fills a blank from the environment, then the file', async () => {
    const { env } = await own({ codegen: { provider: 'openai', model: 'gpt-4o-mini' } });
    expect(await generationTarget('', '', '/nowhere', env)).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(await generationTarget('', '', '/nowhere', { ...env, AI_GRAPH_GEN_PROVIDER: 'google', AI_GRAPH_GEN_MODEL: 'g' }))
      .toEqual({ provider: 'google', model: 'g' });
  });

  it('treats "default" as nothing named', async () => {
    const { env } = await own({ codegen: { provider: 'openai', model: 'gpt-4o-mini' } });
    expect(await generationTarget('default', '', '/nowhere', env)).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });
});
