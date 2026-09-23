// The two files that start something from the folder they sit in: run.sh and run.cmd.
//
// Two things hand a folder to someone else -- the downloadable package
// (scripts/package.mjs) and every deploy bundle (bundle.ts) -- and each had
// written its own pair: a few bare lines that assumed Node was installed, new
// enough, and started from the right folder. None of that is true on a stranger's
// machine often enough to matter, and on Windows a double-clicked script that
// fails closes its window before anyone can read why, so "it does not start"
// was the whole of the report. The launcher repository's own start.cmd had
// learned all of this; the copies handed to other people had not.

/**
 * The oldest Node the engine runs on. It runs its TypeScript unbuilt, which is
 * also why the check has to happen in the launcher: an older Node does not get
 * as far as reading the engine's first line.
 */
export const NODE_MAJOR = 24;

/** Where to send someone whose Node is missing or too old. */
const GET_NODE = 'https://nodejs.org';

export interface LauncherOptions {
  /** What follows `node`, with forward slashes: `engine/src/main.ts --editor editor/dist`. */
  command: string;
  /**
   * Hand `--port $PORT` on when PORT is set. Left unset, nothing is passed and
   * the engine takes the first free port from 8000 -- which is the behaviour
   * that matters, because a launcher that always passed 8000 turned "something
   * else is already on 8000" into a crash.
   */
  portFromEnv?: boolean;
}

/** The node expression that fails on a Node older than NODE_MAJOR. Quote-safe in sh and cmd. */
const TOO_OLD = `process.exit(Number(process.versions.node.split('.')[0]) < ${NODE_MAJOR} ? 1 : 0)`;

/** `run.sh`, for macOS and Linux. Needs its executable bit -- see `zipMode`. */
export function runSh({ command, portFromEnv = false }: LauncherOptions): string {
  const port = portFromEnv ? ' ${PORT:+--port "$PORT"}' : '';
  return [
    '#!/bin/sh',
    `# Needs Node ${NODE_MAJOR} or newer, and nothing else.`,
    '# From its own folder: wherever it was started from, the paths below are relative to it.',
    'cd "$(dirname "$0")" || exit 1',
    'if ! command -v node >/dev/null 2>&1; then',
    `  echo "Node.js is not installed. Get it from ${GET_NODE} (${NODE_MAJOR} or newer), then run this again." >&2`,
    '  exit 1',
    'fi',
    `if ! node -e "${TOO_OLD}"; then`,
    `  echo "This needs Node.js ${NODE_MAJOR} or newer, and this computer has $(node --version). Get the current one from ${GET_NODE}." >&2`,
    '  exit 1',
    'fi',
    `exec node ${command}${port} "$@"`,
    '',
  ].join('\n');
}

/**
 * `run.cmd`, for Windows.
 *
 * Every way out that is a failure goes through `:failed`, which pauses: a
 * double-clicked window closes the moment the script ends, and a message
 * nobody could read is the same as no message. AI_GRAPH_NO_PAUSE is for
 * scripts and tests, which have nobody to press a key.
 */
export function runCmd({ command, portFromEnv = false }: LauncherOptions): string {
  const windowsCommand = command.replace(/\//g, '\\');
  return [
    '@echo off',
    `rem Needs Node ${NODE_MAJOR} or newer, and nothing else.`,
    'rem From its own folder: a double-click, a shortcut and "Run as administrator"',
    'rem each start somewhere else, and the paths below are relative to this one.',
    'setlocal',
    'set "CODE=1"',
    'cd /d "%~dp0"',
    'where node >nul 2>&1 || (',
    '  echo.',
    `  echo Node.js is not installed. Get it from ${GET_NODE} ^(${NODE_MAJOR} or newer^), then run this again.`,
    '  goto :failed',
    ')',
    `node -e "${TOO_OLD}" || (`,
    '  echo.',
    `  for /f "delims=" %%v in ('node --version') do echo This needs Node.js ${NODE_MAJOR} or newer, and this computer has %%v.`,
    `  echo Get the current one from ${GET_NODE}, then run this again.`,
    '  goto :failed',
    ')',
    ...(portFromEnv ? ['set "PORTARG="', 'if defined PORT set "PORTARG=--port %PORT%"'] : []),
    `node ${windowsCommand}${portFromEnv ? ' %PORTARG%' : ''} %*`,
    'set "CODE=%ERRORLEVEL%"',
    'if "%CODE%"=="0" exit /b 0',
    'echo.',
    'echo It stopped with an error -- the reason is above.',
    '',
    ':failed',
    'if not defined AI_GRAPH_NO_PAUSE (',
    '  echo.',
    '  pause',
    ')',
    'exit /b %CODE%',
    '',
  ].join('\r\n');
}

/**
 * The Unix permissions an archived file needs, or none.
 *
 * A zip written without them unpacks every file as not executable, so
 * `./run.sh` -- the first thing the README says to type -- answered
 * "Permission denied" on every Mac and Linux machine. Decided by name rather
 * than by the file on disk, because the editor that writes a bundle zip may
 * well be running on Windows, which has no executable bit to read.
 */
export function zipMode(path: string): number | undefined {
  return path.endsWith('.sh') ? 0o755 : undefined;
}
