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
// The same file the editor's Python half reads, so one configuration serves
// both while both exist.
//
// It is **not** in the repository and must not be: `.gitignore` names it, and
// `ai-settings.example.json` beside it shows the shape with no key in it.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settingsFromEnv, type ProviderSettings } from './providers.ts';

const FILENAME = 'ai-settings.json';

/**
 * Where the file is looked for, in order.
 *
 * `AI_GRAPH_SETTINGS` is not the first of several candidates but the only one:
 * "use this file" has to mean that even when the file is not there yet, or the
 * search quietly falls through to some other machine-wide file and the answer
 * depends on what else happens to be installed. The Python half settled this
 * the same way, for the same reason.
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

interface SettingsFile {
  ai?: { provider?: string; model?: string };
  api_keys?: Record<string, string>;
  endpoints?: Record<string, string>;
}

/** The file's contents, or nothing. A malformed file is ignored, not fatal. */
export function fromFile(
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Partial<ProviderSettings> {
  for (const path of candidatePaths(cwd, env)) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as SettingsFile;
      return {
        ...(parsed.ai?.provider ? { provider: parsed.ai.provider } : {}),
        ...(parsed.ai?.model ? { model: parsed.ai.model } : {}),
        apiKeys: parsed.api_keys ?? {},
        endpoints: parsed.endpoints ?? {},
      };
    } catch {
      // A settings file someone is halfway through editing should not stop a
      // run that does not need a model at all.
      return {};
    }
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

export { FILENAME as SETTINGS_FILENAME };
