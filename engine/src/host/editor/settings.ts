// The editor's settings dialog, and the one file behind it.
//
// Two questions live here. Which endpoints and keys are configured, and which
// AI the one setting names. The file is the same one the engine reads at run
// time (`ai/settings.ts`), so a key or a model saved in the dialog is the one a
// run uses; the dialog never reads a key back, only whether one is set and
// where it came from.
//
// Editor-only: a deployed tool is configured through its environment, and a
// page that could write credentials into a file nobody asked for is not a page
// a recipient should be handed. Hence `host/editor/`.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  aiSetting, candidatePaths, LOCAL_PROVIDERS, parseSettingsFile, probeLocal, readSettingsFile, type SettingsFile,
} from '../../ai/settings.ts';
import { Refusal, message } from '../http.ts';
import { CREDENTIALS, DEFAULT_SETTINGS, ENDPOINT_ENV } from '../../ai/providers.ts';
import type { ProviderStatus, SettingsPatch, SettingsStatus, Target } from '../api.ts';

type Env = Record<string, string | undefined>;

/** The providers whose base URL a person may point somewhere else: the ones the environment can point, too. */
const ENDPOINT_PROVIDERS = Object.keys(ENDPOINT_ENV);

/** The variables that are the one AI setting on a machine without the dialog. */
const AI_ENV = ['AI_GRAPH_AI_PROVIDER', 'AI_GRAPH_AI_MODEL'];

/**
 * The file that is in use, or would be written.
 *
 * `AI_GRAPH_SETTINGS` wins outright, whether or not the file exists yet: "use
 * this file" has to hold for the first write too, or a save silently lands
 * somewhere else. Otherwise the first candidate that exists, else the first
 * candidate, which is where a save creates it.
 */
export function settingsPath(cwd = process.cwd(), env: Env = process.env): string {
  const candidates = candidatePaths(cwd, env);
  return candidates.find((path) => existsSync(path)) ?? candidates[0];
}

/** What the dialog shows: the AI saved, endpoints, and whether each credential is set — never the credential. */
export function status(cwd = process.cwd(), env: Env = process.env): SettingsStatus {
  const path = settingsPath(cwd, env);
  const file = readSettingsFile(path);
  const endpoints: Record<string, string> = {};
  for (const provider of ENDPOINT_PROVIDERS) endpoints[provider] = file.endpoints?.[provider] ?? '';
  const credentials: Record<string, { configured: boolean; source: string }> = {};
  for (const [provider, { key, env: variable }] of Object.entries(CREDENTIALS)) {
    const fromEnv = Boolean(env[variable]?.trim());
    const stored = Boolean(file.api_keys?.[key]?.trim());
    credentials[provider] = {
      configured: fromEnv || stored,
      source: fromEnv ? 'environment' : stored ? 'settings file' : '',
    };
  }
  return {
    settings_file: path,
    ai: {
      provider: file.ai?.provider ?? '',
      model: file.ai?.model ?? '',
      environment: AI_ENV.filter((variable) => env[variable]?.trim()),
    },
    endpoints,
    credentials,
  };
}

/**
 * Merge a change into the file and write it back.
 *
 * Merging rather than replacing, and treating an empty key as "leave alone",
 * means saving one provider's key never clears another's — and that a dialog
 * which cannot read keys back can still save without wiping them.
 */
export async function save(patch: SettingsPatch, cwd = process.cwd(), env: Env = process.env): Promise<SettingsStatus> {
  const path = settingsPath(cwd, env);
  let file: SettingsFile;
  try {
    file = parseSettingsFile(path);
  } catch (error) {
    throw new Refusal(409, `${path} cannot be read (${message(error)}). Fix it by hand first: saving over it now would lose the keys and tool servers in it.`);
  }
  const endpoints = { ...file.endpoints };
  const apiKeys = { ...file.api_keys };

  for (const [provider, value] of Object.entries(patch.endpoints ?? {})) {
    if (!ENDPOINT_PROVIDERS.includes(provider)) continue;
    // Left blank, the provider's own address stands: a blank one is not written.
    const url = String(value ?? '').trim();
    if (url) endpoints[provider] = url;
    else delete endpoints[provider];
  }
  for (const [provider, value] of Object.entries(patch.api_keys ?? {})) {
    const key = CREDENTIALS[provider]?.key;
    const text = String(value ?? '').trim();
    if (key && text) apiKeys[key] = text;
  }
  for (const provider of patch.clear_keys ?? []) {
    const key = CREDENTIALS[provider]?.key;
    if (key) delete apiKeys[key];
  }

  // Everything else the file says -- the tool servers, a key nobody reads any
  // more -- is kept as it was.
  const next: SettingsFile = {
    ...file,
    api_keys: apiKeys,
    endpoints,
  };
  if (patch.ai) {
    // 'default' or nothing is "not set": the entry goes, and `aiSetting` falls
    // back as it does on a machine nobody configured.
    const provider = patch.ai.provider && patch.ai.provider !== 'default' ? patch.ai.provider.trim() : '';
    const model = String(patch.ai.model ?? '').trim();
    next.ai = { ...(provider ? { provider } : {}), ...(model ? { model } : {}) };
    if (!provider && !model) delete next.ai;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return status(cwd, env);
}

/**
 * What the editor would use if asked right now, as a line for the terminal it
 * was started from.
 *
 * Printed at startup because the setting has a default that resolves to
 * something -- Ollama, whether or not it is running -- so a machine with
 * nothing configured looks configured until the first run fails. Never a key,
 * only whether one is there: this goes to a terminal and into scrollback.
 */
export async function setupLines(cwd = process.cwd(), env: Env = process.env): Promise<string[]> {
  const { local, target } = await providerStatus(cwd, env);
  const configured = status(cwd, env);

  const trouble = (chosen: Target): string => {
    if ((LOCAL_PROVIDERS as readonly string[]).includes(chosen.provider)) {
      return local[chosen.provider]?.reachable
        ? ''
        : ` -- not answering at ${configured.endpoints[chosen.provider] || DEFAULT_SETTINGS.endpoints[chosen.provider]}`;
    }
    const wanted = CREDENTIALS[chosen.provider];
    return wanted && !configured.credentials[chosen.provider]?.configured
      ? ` -- no ${chosen.provider} API key (⚙ Settings, or ${wanted.env})`
      : '';
  };

  return [`AI (✨, ▶ Try, runs): ${target.provider}/${target.model || '(no model)'}${trouble(target)}`];
}

/** Which providers are usable right now, and what the one AI setting resolves to. */
export async function providerStatus(cwd = process.cwd(), env: Env = process.env): Promise<ProviderStatus> {
  const local: ProviderStatus['local'] = {};
  await Promise.all(LOCAL_PROVIDERS.map(async (provider) => {
    const models = await probeLocal(provider, { refresh: true, cwd, env });
    local[provider] = { reachable: models !== null, models: models ?? [] };
  }));
  return { local, target: await aiSetting(cwd, env) };
}
