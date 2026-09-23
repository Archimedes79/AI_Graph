import { describe, it, expect } from 'vitest';
import { NODE_MAJOR, runCmd, runSh, zipMode } from './launchers.ts';

/**
 * What the two launchers promise, read off their text.
 *
 * Whether they actually start anything is scripts/package.test.mjs, which
 * unzips the package and runs them on Linux and Windows. This is the part that
 * does not need a Node 24 or a built page: that both files check for Node
 * before using it, start from their own folder, and pass a port only when one
 * was asked for.
 */
describe('run.sh', () => {
  const script = runSh({ command: 'engine/main.ts graph.json --serve' });

  it('starts from its own folder and checks for Node first', () => {
    const lines = script.split('\n');
    expect(lines[0]).toBe('#!/bin/sh');
    const at = (text: string) => lines.findIndex((line) => line.includes(text));
    expect(at('cd "$(dirname "$0")"')).toBeGreaterThan(0);
    expect(at('command -v node')).toBeGreaterThan(at('cd "$(dirname'));
    expect(at(`< ${NODE_MAJOR} ? 1 : 0`)).toBeGreaterThan(at('command -v node'));
    expect(at('exec node engine/main.ts graph.json --serve "$@"')).toBeGreaterThan(at(`< ${NODE_MAJOR}`));
  });

  it('passes a port only when asked to, and then only when PORT is set', () => {
    expect(script).not.toContain('PORT');
    expect(runSh({ command: 'engine/src/main.ts', portFromEnv: true }))
      .toContain('exec node engine/src/main.ts ${PORT:+--port "$PORT"} "$@"');
  });
});

describe('run.cmd', () => {
  const script = runCmd({ command: 'engine/src/main.ts --editor editor/dist', portFromEnv: true });
  const lines = script.split('\r\n');

  it('uses Windows line endings and backslashes', () => {
    expect(script).not.toMatch(/[^\r]\n/);
    expect(script).toContain('node engine\\src\\main.ts --editor editor\\dist %PORTARG% %*');
  });

  it('starts from its own folder and checks for Node first', () => {
    const at = (text: string) => lines.findIndex((line) => line.includes(text));
    expect(at('cd /d "%~dp0"')).toBeGreaterThan(0);
    expect(at('where node')).toBeGreaterThan(at('cd /d'));
    expect(at(`< ${NODE_MAJOR} ? 1 : 0`)).toBeGreaterThan(at('where node'));
    expect(at('node engine\\src\\main.ts')).toBeGreaterThan(at(`< ${NODE_MAJOR}`));
  });

  it('keeps the window open on every way out that is a failure', () => {
    // A double-clicked window closes the moment the script ends. Every failure
    // leads to :failed, and :failed pauses unless a script asked it not to.
    const failures = lines.filter((line) => line.includes('goto :failed')).length;
    expect(failures).toBe(2);
    const failed = lines.indexOf(':failed');
    expect(failed).toBeGreaterThan(lines.findIndex((line) => line.includes('if "%CODE%"=="0" exit /b 0')));
    expect(lines.slice(failed)).toContain('  pause');
    expect(lines.slice(failed).join('\n')).toContain('if not defined AI_GRAPH_NO_PAUSE');
    expect(lines.at(-2)).toBe('exit /b %CODE%');
  });

  it('passes a port only when PORT is defined', () => {
    expect(lines).toContain('if defined PORT set "PORTARG=--port %PORT%"');
    expect(runCmd({ command: 'engine/main.ts graph.json' })).not.toContain('PORT');
  });
});

describe('zipMode', () => {
  it('makes shell scripts executable and leaves everything else alone', () => {
    expect(zipMode('run.sh')).toBe(0o755);
    expect(zipMode('ai-graph-v1/run.sh')).toBe(0o755);
    expect(zipMode('run.cmd')).toBeUndefined();
    expect(zipMode('engine/main.ts')).toBeUndefined();
  });
});
