// The editor's settings dialog, and the one file behind it.
//
// Two questions live here. Which endpoints and keys are configured, and which
// model a request ends up at when nobody named one. The file is the same one
// the engine reads at run time (`ai/settings.ts`), so a key saved in the dialog
// is the key a run uses; the dialog never reads a key back, only whether one is
// set and where it came from.
//
// Editor-only: a deployed tool is configured through its environment, and a
// page that could write credentials into a file nobody asked for is not a page
// a recipient should be handed. Hence `host/editor/`.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { candidatePaths, fromFile, readSettingsFile, type SettingsFile } from '../../ai/settings.ts';
import { DEFAULT_SETTINGS, settingsFromEnv } from '../../ai/providers.ts';

type Env = Record<string, string | undefined>;

/** The providers whose base URL a person may point somewhere else. */
export const ENDPOINT_PROVIDERS = ['ollama', 'lmstudio', 'openai_compatible', 'google', 'github_copilot'] as const;

/** The providers that want a credential, and the env var that can supply it instead. */
export const CREDENTIALS: Record<string, { key: string; env: string }> = {
  openai: { key: 'openai', env: 'OPENAI_API_KEY' },
  anthropic: { key: 'anthropic', env: 'ANTHROPIC_API_KEY' },
  openai_compatible: { key: 'openai_compatible', env: 'OPENAI_COMPATIBLE_API_KEY' },
  google: { key: 'google', env: 'GOOGLE_API_KEY' },
  github_copilot: { key: 'github', env: 'GITHUB_TOKEN' },
};

/** A usable model when none was configured, per provider. Empty: only the user knows. */
export const DEFAULT_MODELS: Record<string, string> = {
  ollama: 'llama3',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-opus-5',
  google: 'gemini-flash-lite-latest',
  github_copilot: 'gpt-4o-mini',
};

export const LOCAL_PROVIDERS = ['ollama', 'lmstudio'] as const;

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

export interface SettingsStatus {
  settings_file: string;
  settings_file_exists: boolean;
  endpoint_keys: Record<string, string>;
  endpoints: Record<string, string>;
  credentials: Record<string, { configured: boolean; source: string }>;
}

/** What the dialog shows: endpoints, and whether each credential is set — never the credential. */
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
    settings_file_exists: existsSync(path),
    // The same word on both sides now: the file's keys are the provider names.
    endpoint_keys: Object.fromEntries(ENDPOINT_PROVIDERS.map((p) => [p, p])),
    endpoints,
    credentials,
  };
}

export interface SettingsPatch {
  endpoints?: Record<string, string>;
  api_keys?: Record<string, string>;
  /** Providers whose stored key is to be removed — distinct from "left blank". */
  clear_keys?: string[];
  ai?: { provider?: string; model?: string; force?: boolean };
  codegen?: { provider?: string; model?: string };
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
  const file = readSettingsFile(path);
  const endpoints = { ...file.endpoints };
  const apiKeys = { ...file.api_keys };

  for (const [provider, value] of Object.entries(patch.endpoints ?? {})) {
    if ((ENDPOINT_PROVIDERS as readonly string[]).includes(provider)) endpoints[provider] = String(value ?? '').trim();
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

  const next: SettingsFile = {
    ...file,
    ...(patch.ai ? { ai: { ...file.ai, ...patch.ai } } : {}),
    ...(patch.codegen ? { codegen: { ...file.codegen, ...patch.codegen } } : {}),
    api_keys: apiKeys,
    endpoints,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return status(cwd, env);
}

// ---------------------------------------------------------------------------
// Which model a request lands at
// ---------------------------------------------------------------------------

/**
 * Cached per provider, but only for a few seconds.
 *
 * It used to be cached for the life of the process, so swapping the loaded
 * model in LM Studio was invisible until something asked with `refresh` --
 * which only the status route does. A local probe is one request to a machine
 * you are already talking to, so the cache is here to keep a burst of
 * generate calls from making a burst of probes, nothing more.
 */
const probed = new Map<string, { models: string[] | null; at: number }>();
const PROBE_TTL_MS = 5_000;

/**
 * The models a local provider serves right now, or null when it is not there.
 *
 * Asked of the provider itself rather than assumed: "configure the AI once"
 * only helps if there is something sensible when nothing was configured, and
 * a machine that runs LM Studio instead of Ollama should not get connection
 * errors out of the box. Cached per process; `refresh` re-asks, which the
 * editor's status route does so starting LM Studio mid-session is noticed.
 */
export async function probeLocal(
  provider: string,
  { refresh = false, timeoutMs = 1500, cwd = process.cwd(), env = process.env as Env } = {},
): Promise<string[] | null> {
  if (!(LOCAL_PROVIDERS as readonly string[]).includes(provider)) return null;
  const cached = probed.get(provider);
  if (!refresh && cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.models;

  const base = (fromFile(cwd, env).endpoints?.[provider] ?? settingsFromEnv(env).endpoints?.[provider]
    ?? DEFAULT_SETTINGS.endpoints[provider]).replace(/\/+$/, '');
  const url = provider === 'ollama' ? `${base}/api/tags` : `${base}/models`;
  let models: string[] | null = null;
  try {
    const reply = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const payload = await reply.json() as { models?: { name?: string }[]; data?: { id?: string }[] };
    models = provider === 'ollama'
      ? (payload.models ?? []).map((m) => m.name ?? '').filter(Boolean)
      : (payload.data ?? []).map((m) => m.id ?? '').filter(Boolean);
  } catch {
    // Not reachable is a normal answer here, not an error.
  }
  probed.set(provider, { models, at: Date.now() });
  return models;
}

export function forgetProbes(): void {
  probed.clear();
}

async function defaultModelFor(provider: string, options: { cwd: string; env: Env }): Promise<string> {
  const served = await probeLocal(provider, options);
  return served?.[0] ?? DEFAULT_MODELS[provider] ?? '';
}

export interface Target { provider: string; model: string }

/**
 * What a run calls when a node names nothing: the environment, then the file,
 * then whichever local provider is actually running, then Ollama.
 */
export async function runtimeTarget(cwd = process.cwd(), env: Env = process.env): Promise<Target> {
  const configured = { ...fromFile(cwd, env), ...settingsFromEnv(env) };
  let provider = configured.provider ?? '';
  if (!provider) {
    for (const local of LOCAL_PROVIDERS) {
      if (await probeLocal(local, { cwd, env })) { provider = local; break; }
    }
  }
  provider ||= DEFAULT_SETTINGS.provider;
  const model = configured.model || await defaultModelFor(provider, { cwd, env });
  return { provider, model };
}

/**
 * Which AI writes code and prompts — the design-time counterpart, kept apart
 * on purpose: generation deserves a stronger model than the cheap or local one
 * a graph may run on. The editor sends its choice with every request; this
 * fills in the blanks from the environment, the file's `codegen`, then the
 * runtime target.
 */
export async function generationTarget(
  provider = '', model = '', cwd = process.cwd(), env: Env = process.env,
): Promise<Target> {
  const codegen = readSettingsFile(settingsPath(cwd, env)).codegen ?? {};
  const chosenProvider = (provider && provider !== 'default' ? provider : '')
    || env.AI_GRAPH_GEN_PROVIDER || codegen.provider || '';
  const chosenModel = model || env.AI_GRAPH_GEN_MODEL || codegen.model || '';
  if (chosenProvider && chosenModel) return { provider: chosenProvider, model: chosenModel };

  // A provider named without a model takes *its own* default. It used to take
  // the runtime target's model, which is whichever local provider happens to be
  // running -- so choosing Google in the editor and leaving the model blank
  // sent Google an LM Studio model name, and Google replied
  // `404: models/prism-ml/bonsai-27b is not found`.
  if (chosenProvider) return { provider: chosenProvider, model: await defaultModelFor(chosenProvider, { cwd, env }) };

  const fallback = await runtimeTarget(cwd, env);
  return { provider: fallback.provider, model: chosenModel || fallback.model };
}

export interface ProviderStatus {
  local: Record<string, { reachable: boolean; models: string[] }>;
  runtime_target: Target;
  gen_target: Target;
}

/** Which providers are usable right now, and where the two targets resolve to. */
export async function providerStatus(cwd = process.cwd(), env: Env = process.env): Promise<ProviderStatus> {
  const local: ProviderStatus['local'] = {};
  await Promise.all(LOCAL_PROVIDERS.map(async (provider) => {
    const models = await probeLocal(provider, { refresh: true, cwd, env });
    local[provider] = { reachable: models !== null, models: models ?? [] };
  }));
  return {
    local,
    runtime_target: await runtimeTarget(cwd, env),
    gen_target: await generationTarget('', '', cwd, env),
  };
}

