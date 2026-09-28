// Where the model configuration comes from.
//
// Three sources, in the order that lets each override the one below it:
//
//   1. what the caller passed in code
//   2. environment variables
//   3. `ai-settings.json`
//
// The file exists because a key is not something to type into a terminal on
// every run, and because a double-clicked build has no terminal to type it in.
//
// It is **not** in the repository and must not be: `.gitignore` names it, and
// `ai-settings.example.json` beside it shows the shape with no key in it.
//
// The same file says which tool servers this machine has (`mcp_servers`), and
// for those it is the *only* source -- see `configuredMcpServers` for why.
//
// And it holds the one AI setting, which `aiSetting` alone resolves.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, settingsFromEnv, type ProviderSettings } from './providers.ts';
import type { McpServerConfig } from './mcp.ts';
import type { ModelChoice } from '../elements/Runtime.ts';

const FILENAME = 'ai-settings.json';

/**
 * Where the file is looked for, in order.
 *
 * `AI_GRAPH_SETTINGS` is not the first of several candidates but the only one:
 * "use this file" has to mean that even when the file is not there yet, or the
 * search quietly falls through to some other machine-wide file and the answer
 * depends on what else happens to be installed.
 */
export function candidatePaths(
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): string[] {
  if (env.AI_GRAPH_SETTINGS) return [env.AI_GRAPH_SETTINGS];
  return [...new Set([
    join(cwd, FILENAME),
    // Beside the bundle, which is the deployed equivalent of a config file:
    // a recipient drops one next to `run.sh` and never sets a variable.
    join(installFolder(), FILENAME),
    join(homedir(), '.ai-graph', 'settings.json'),
  ])];
}

/**
 * The folder the engine came in, with its launchers: the one holding
 * `engine/` -- a checkout, the downloadable package, a bundle. Found by name,
 * not counted: a bundle keeps `engine/src`'s files in `engine/` itself, and
 * four folders up from here was the folder above the bundle.
 */
export function installFolder(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (basename(dir) !== 'engine' && dirname(dir) !== dir) dir = dirname(dir);
  return dirname(dir);
}

export interface SettingsFile {
  /** The one AI setting (`aiSetting`), as ⚙ Settings saves it. */
  ai?: { provider?: string; model?: string };
  api_keys?: Record<string, string>;
  /** Keyed by provider name: `endpoints.lmstudio`. */
  endpoints?: Record<string, string>;
  /**
   * Tool servers, keyed by the name a graph uses for them.
   *
   * The entries are Claude Desktop's `mcpServers` entries, so the snippet in
   * any MCP server's README pastes in as it is; `{ "url": … }` is added for a
   * server reached over HTTP.
   */
  mcp_servers?: Record<string, McpServerConfig>;
}

/**
 * One settings file, parsed, or why it cannot be: missing is empty, anything
 * but a JSON object throws. For a writer, which must not save over a file it
 * could not read -- the keys and tool servers in it would be gone.
 */
export function parseSettingsFile(path: string): SettingsFile {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('it is not a JSON object');
  return parsed as SettingsFile;
}

/**
 * One settings file, parsed. Missing is empty; malformed is empty too, because
 * a file someone is halfway through editing should not stop a run that does
 * not need a model at all.
 */
export function readSettingsFile(path: string): SettingsFile {
  try {
    return parseSettingsFile(path);
  } catch {
    return {};
  }
}

/** The first settings file that exists, as provider settings, or nothing. */
export function fromFile(
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Partial<ProviderSettings> {
  for (const path of candidatePaths(cwd, env)) {
    if (!existsSync(path)) continue;
    const parsed = readSettingsFile(path);
    // Malformed reads as empty, and empty means "nothing configured here" --
    // not "keys and endpoints, both blank", which would look configured.
    if (Object.keys(parsed).length === 0) return {};
    return {
      ...(parsed.ai?.provider ? { provider: parsed.ai.provider } : {}),
      ...(parsed.ai?.model ? { model: parsed.ai.model } : {}),
      apiKeys: parsed.api_keys ?? {},
      // A blank address is no address: the provider's own default stands.
      endpoints: Object.fromEntries(Object.entries(parsed.endpoints ?? {}).filter(([, url]) => String(url ?? '').trim())),
    };
  }
  return {};
}

/**
 * The file, then the environment on top of it.
 *
 * An explicitly set variable wins, which is what makes `AI_GRAPH_AI_MODEL=x`
 * on one command a usable thing to do without editing the file.
 */
export function configuredSettings(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): Partial<ProviderSettings> {
  // The same environment for both halves: reading the file through
  // `process.env` while everything else follows the argument made the answer
  // depend on the machine the caller was trying to hold still.
  const file = fromFile(cwd, env);
  const environment = settingsFromEnv(env);
  return {
    ...file,
    ...environment,
    apiKeys: { ...file.apiKeys, ...environment.apiKeys },
    endpoints: { ...file.endpoints, ...environment.endpoints },
  };
}

// ---------------------------------------------------------------------------
// The one AI setting
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

/** A usable model when none was configured, per provider. Empty: only the user knows. */
const DEFAULT_MODELS: Record<string, string> = {
  ollama: 'llama3',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-opus-5',
  google: 'gemini-flash-lite-latest',
  github_copilot: 'gpt-4o-mini',
};

export const LOCAL_PROVIDERS = ['ollama', 'lmstudio'] as const;

/**
 * Cached per provider, but only for a few seconds.
 *
 * It used to be cached for the life of the process, so swapping the loaded
 * model in LM Studio was invisible until something asked with `refresh` --
 * which only the status route does. A local probe is one request to a machine
 * you are already talking to, so the cache is here to keep a burst of calls
 * from making a burst of probes, nothing more.
 */
const probed = new Map<string, { models: string[] | null; at: number }>();
const PROBE_TTL_MS = 5_000;

/**
 * The models a local provider serves right now, or null when it is not there.
 *
 * Asked of the provider itself rather than assumed: a machine that runs LM
 * Studio instead of Ollama should not get connection errors out of the box.
 * `refresh` re-asks, which the editor's status route does so starting LM
 * Studio mid-session is noticed.
 */
export async function probeLocal(
  provider: string,
  { refresh = false, timeoutMs = 1500, cwd = process.cwd(), env = process.env as Env } = {},
): Promise<string[] | null> {
  if (!(LOCAL_PROVIDERS as readonly string[]).includes(provider)) return null;
  const cached = probed.get(provider);
  if (!refresh && cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.models;

  // Where a call goes: the environment over the file, as `configuredSettings` has it.
  const base = (configuredSettings(env, cwd).endpoints?.[provider] ?? DEFAULT_SETTINGS.endpoints[provider]).replace(/\/+$/, '');
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

/**
 * The one AI setting: where every AI call goes that does not name its own
 * provider and model -- ✨ and its probe, ▶ Try, and
 * every run, in the editor, from the command line and in a deployed tool
 * alike. Only a node that pins its own model is answered by
 * anything else.
 *
 * Read here and nowhere else, so the editor's "now: …" and what a run calls
 * cannot disagree. The file's `ai` section is what ⚙ Settings saves;
 * `AI_GRAPH_AI_PROVIDER` / `AI_GRAPH_AI_MODEL` are the same setting for a
 * machine with no dialog, and win over the file. With nothing set it is
 * whichever local provider is running, else Ollama. A provider named without a
 * model takes *its own* default: choosing Google and leaving the model blank
 * once sent Google whatever LM Studio had loaded, and Google answered with a
 * 404 that read like a broken endpoint.
 */
export async function aiSetting(cwd = process.cwd(), env: Env = process.env): Promise<ModelChoice> {
  const configured = configuredSettings(env, cwd);
  let provider = configured.provider ?? '';
  if (!provider) {
    for (const local of LOCAL_PROVIDERS) {
      if (await probeLocal(local, { cwd, env })) { provider = local; break; }
    }
  }
  provider ||= DEFAULT_SETTINGS.provider;
  if (configured.model) return { provider, model: configured.model };
  const served = await probeLocal(provider, { cwd, env });
  return { provider, model: served?.[0] ?? DEFAULT_MODELS[provider] ?? '' };
}

/**
 * The tool servers this machine has configured, from the first settings file
 * that exists -- the same file the key comes from, found the same way.
 *
 * This is the only source there is, and that is the point of it. A graph names
 * a tool server; what the name *starts* is written here, by whoever owns the
 * machine, in a file that is not in the repository and does not travel with a
 * graph. There is deliberately no environment variable on top, unlike
 * everything else in this file: a command line assembled from `AI_GRAPH_…`
 * variables is one more place a program to run could come from, and one is the
 * right number.
 *
 * An entry that is neither a command nor a URL is dropped rather than passed
 * on, so what reaches the client is only ever one of the two shapes it knows.
 * A graph naming a dropped entry is told it is not configured, which is true.
 */
export function configuredMcpServers(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): Record<string, McpServerConfig> {
  for (const path of candidatePaths(cwd, env)) {
    if (!existsSync(path)) continue;
    const listed = readSettingsFile(path).mcp_servers;
    if (!listed || typeof listed !== 'object' || Array.isArray(listed)) return {};

    const servers: Record<string, McpServerConfig> = {};
    for (const [name, entry] of Object.entries(listed)) {
      const { command, url } = (entry ?? {}) as { command?: unknown; url?: unknown };
      if ((typeof command === 'string' && command) || (typeof url === 'string' && url)) servers[name] = entry;
    }
    return servers;
  }
  return {};
}

export { FILENAME as SETTINGS_FILENAME };
