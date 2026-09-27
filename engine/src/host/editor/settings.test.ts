import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerStatus, save, settingsPath, setupLines, status } from './settings.ts';
import { aiSetting, configuredSettings, probeLocal, readSettingsFile } from '../../ai/settings.ts';

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
    expect(status('/nowhere', env).settings_file).toBe(file);
    expect(existsSync(file)).toBe(false);
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

  it('will not save over a file it cannot read, which would lose its keys and tool servers', async () => {
    const { file, env } = await own();
    const handEdited = '{\n "api_keys": {"openai": "sk-test-1234567890"},\n "mcp_servers": {"files": {"command": "npx"}},\n}\n';
    await writeFile(file, handEdited);
    await expect(save({ endpoints: { ollama: 'http://127.0.0.1:11434' } }, '/nowhere', env)).rejects.toMatchObject({ status: 409 });
    expect(await readFile(file, 'utf8')).toBe(handEdited);
  });

  it('writes no blank address: the provider\'s own stands, and calls still reach it', async () => {
    const { file, env } = await own({ endpoints: { ollama: 'http://old:11434' } });
    await save({ endpoints: { ollama: '', lmstudio: 'http://box:1234/v1' } }, '/nowhere', env);
    expect(JSON.parse(await readFile(file, 'utf8')).endpoints).toEqual({ lmstudio: 'http://box:1234/v1' });
    await writeFile(file, JSON.stringify({ endpoints: { ollama: '' } }));
    expect(configuredSettings(env, '/nowhere').endpoints).toEqual({});
  });

  it('creates the file, and its folder, on first save', async () => {
    const { dir } = await own();
    const nested = join(dir, 'deep', 'ai-settings.json');
    const seen = await save({ endpoints: { ollama: 'http://x' } }, '/nowhere', { AI_GRAPH_SETTINGS: nested });
    expect(seen.settings_file).toBe(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it('writes the one AI setting, and unsets it for "default"', async () => {
    const { file, env } = await own({ api_keys: { openai: 'keep-me' }, mcp_servers: { fs: { command: 'x' } } });
    const seen = await save({ ai: { provider: 'openai', model: 'gpt-5' } }, '/nowhere', env);
    expect(readSettingsFile(file)).toMatchObject({ ai: { provider: 'openai', model: 'gpt-5' }, api_keys: { openai: 'keep-me' }, mcp_servers: { fs: { command: 'x' } } });
    expect(seen.ai).toEqual({ provider: 'openai', model: 'gpt-5', environment: [] });

    await save({ ai: { provider: 'default', model: '' } }, '/nowhere', env);
    expect(readSettingsFile(file).ai).toBeUndefined();
  });

  it('leaves the AI setting alone when a save is about something else', async () => {
    const { file, env } = await own({ ai: { provider: 'openai' } });
    await save({ api_keys: { openai: 'k' } }, '/nowhere', env);
    expect(readSettingsFile(file).ai).toEqual({ provider: 'openai' });
  });

  it('says which variables set the AI on this machine instead', async () => {
    const { env } = await own({ ai: { provider: 'openai', model: 'gpt-5' } });
    expect(status('/nowhere', { ...env, AI_GRAPH_AI_MODEL: 'other' }).ai)
      .toEqual({ provider: 'openai', model: 'gpt-5', environment: ['AI_GRAPH_AI_MODEL'] });
  });
});

describe('the one AI setting', () => {
  it('is the file\'s `ai`, and the environment wins over it', async () => {
    const { env } = await own({ ai: { provider: 'openai', model: 'gpt-4o-mini' } });
    expect(await aiSetting('/nowhere', env)).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(await aiSetting('/nowhere', { ...env, AI_GRAPH_AI_PROVIDER: 'google', AI_GRAPH_AI_MODEL: 'g' }))
      .toEqual({ provider: 'google', model: 'g' });
  });

  it('is what the editor is told it is now', async () => {
    const { env } = await own({ ai: { provider: 'anthropic', model: 'claude-x' } });
    expect((await providerStatus('/nowhere', env)).target).toEqual({ provider: 'anthropic', model: 'claude-x' });
  });

  it('looks for a local model where a call would go: the environment over the file', async () => {
    const { env } = await own({ endpoints: { ollama: 'http://file-ollama:11434' } });
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { asked.push(url); return new Response(JSON.stringify({ models: [{ name: 'm1' }] })); });
    try {
      await probeLocal('ollama', { refresh: true, cwd: '/nowhere', env: { ...env, OLLAMA_BASE_URL: 'http://env-ollama:11434' } });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(asked).toEqual(['http://env-ollama:11434/api/tags']);
  });
});

describe('a provider named without a model', () => {
  /**
   * The bug this pins down: choosing Google and leaving the model blank used
   * to fall back to whichever local provider happened to be running for the
   * model. Google was then sent an LM Studio model name and answered
   *
   *   404: models/prism-ml/bonsai-27b is not found for API version v1main
   *
   * A model belongs to the provider it was chosen for, never to another.
   */
  it('gets that provider\'s own default model', async () => {
    const { env } = await own({ ai: { provider: 'google' } });
    expect(await aiSetting('/nowhere', env)).toEqual({ provider: 'google', model: 'gemini-flash-lite-latest' });
  });

  it('does the same for every hosted provider', async () => {
    expect((await aiSetting('/nowhere', (await own({ ai: { provider: 'anthropic' } })).env)).model).toBe('claude-opus-5');
    expect((await aiSetting('/nowhere', (await own({ ai: { provider: 'openai' } })).env)).model).toBe('gpt-4o-mini');
  });
});

describe('what the terminal is told at startup', () => {
  it('names the one AI, and what is missing, and never a key', async () => {
    const { env } = await own({
      ai: { provider: 'anthropic', model: 'claude-opus-5' },
      api_keys: { openai: 'sk-secret' },
    });
    const lines = await setupLines('/nowhere', env);

    expect(lines).toEqual(['AI (✨ Generate, Try it, runs): anthropic/claude-opus-5 -- no anthropic API key (⚙ Settings, or ANTHROPIC_API_KEY)']);
    expect(lines.join('\n')).not.toContain('sk-secret');
  });
});

