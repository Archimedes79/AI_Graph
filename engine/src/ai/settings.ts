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

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settingsFromEnv, type ProviderSettings } from './providers.ts';
import type { McpServerConfig } from './mcp.ts';

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
  const beside = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
  return [...new Set([
    join(cwd, FILENAME),
    // Beside the bundle, which is the deployed equivalent of a config file:
    // a recipient drops one next to `run.sh` and never sets a variable.
    join(beside, FILENAME),
    join(homedir(), '.ai-graph', 'settings.json'),
  ])];
}

export interface SettingsFile {
  ai?: { provider?: string; model?: string; force?: boolean };
  codegen?: { provider?: string; model?: string };
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
 * One settings file, parsed. Missing is empty; malformed is empty too, because
 * a file someone is halfway through editing should not stop a run that does
 * not need a model at all.
 */
export function readSettingsFile(path: string): SettingsFile {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SettingsFile;
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
      endpoints: parsed.endpoints ?? {},
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
