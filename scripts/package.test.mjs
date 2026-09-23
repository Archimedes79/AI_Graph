// What someone who downloads the zip gets, tried the way they try it:
// `node --test scripts/package.test.mjs`, after `npm run build`.
//
// Not a unit test. v0.2.0's zip was intact and still "did not start": its
// run.cmd assumed Node was there and new enough, always asked for port 8000 --
// busy on any machine already running an editor -- and closed its window
// before the error could be read, while its run.sh came out of the archive
// without an executable bit. None of that shows without unzipping it and
// double-clicking, so this does exactly that, on Linux and on Windows.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const work = mkdtempSync(join(tmpdir(), 'ai-graph-package-'));
const folder = join(work, 'ai-graph-test');
const launcher = join(folder, windows ? 'run.cmd' : 'run.sh');

/** Every child this file started, so a failure halfway leaves no editor behind. */
const started = [];

after(() => {
  for (const child of started) stopTree(child);
  rmSync(work, { recursive: true, force: true });
});

/** On Windows the launcher is cmd.exe with node under it; killing cmd.exe alone orphans node. */
function stopTree(child) {
  if (child.exitCode !== null) return;
  if (windows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill();
}

/**
 * The environment a person's shell would hand the launcher, plus *overrides*.
 *
 * Keys are matched without regard to case, because on Windows the path is
 * usually `Path`: adding a second `PATH` beside it leaves which one the child
 * sees to chance. PORT is removed rather than emptied -- whether cmd counts an
 * empty variable as defined is exactly the kind of thing this test should not
 * depend on.
 */
function environment(overrides = {}) {
  const env = { ...process.env, AI_GRAPH_NO_BROWSER: '1', AI_GRAPH_NO_PAUSE: '1' };
  const keyOf = (name) => Object.keys(env).find((key) => key.toUpperCase() === name.toUpperCase());
  for (let key = keyOf('PORT'); key; key = keyOf('PORT')) delete env[key];
  for (const [name, value] of Object.entries(overrides)) env[keyOf(name) ?? name] = value;
  return env;
}

/** The PATH this process was started with, whatever its key is spelled. */
const currentPath = () => environment().PATH ?? environment().Path ?? Object.entries(process.env)
  .find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';

/** Start the launcher as a double-click would: its path, from some other folder. */
function launch(env = {}) {
  const command = windows ? process.env.ComSpec || 'cmd.exe' : launcher;
  const args = windows ? ['/d', '/c', launcher] : [];
  const child = spawn(command, args, {
    cwd: work,
    env: environment(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(child);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const served = new Promise((found, failed) => {
    const look = () => {
      const url = /Serving on (http:\/\/\S+)/.exec(output)?.[1];
      if (url) found(url);
    };
    child.stdout.on('data', look);
    child.stderr.on('data', look);
    child.on('exit', (code) => failed(new Error(`the launcher ended (${code}) before serving:\n${output}`)));
  });
  // A launcher that is meant to stop -- an old Node -- never serves, and a
  // rejection nobody awaits would fail the run from outside any test.
  served.catch(() => {});
  const ended = new Promise((done) => child.on('exit', (code) => done({ code, output })));
  return { child, served, ended, output: () => output };
}

/** Hold 8000 the way an editor already running there does -- if nothing else already is. */
function occupy(port) {
  return new Promise((held) => {
    const server = createServer();
    server.once('error', () => held(null));
    server.listen(port, '127.0.0.1', () => held(server));
  });
}

/** A `node` earlier on PATH that says it is version 20 and fails everything else. */
function oldNode() {
  const dir = join(work, 'old-node');
  mkdirSync(dir, { recursive: true });
  if (windows) {
    writeFileSync(join(dir, 'node.cmd'), '@echo off\r\nif "%1"=="--version" (echo v20.0.0& exit /b 0)\r\nexit /b 1\r\n');
  } else {
    writeFileSync(join(dir, 'node'), '#!/bin/sh\n[ "$1" = "--version" ] && { echo v20.0.0; exit 0; }\nexit 1\n');
    chmodSync(join(dir, 'node'), 0o755);
  }
  return dir;
}

test('the zip holds what a person runs', () => {
  assert.ok(existsSync(join(root, 'editor', 'dist', 'index.html')), 'build the editor first: npm run build');
  const zip = join(work, 'ai-graph-test.zip');
  const packed = spawnSync(process.execPath, [join(root, 'scripts', 'package.mjs'), zip], {
    cwd: root, encoding: 'utf8', env: { ...process.env, AI_GRAPH_VERSION: 'test' },
  });
  assert.equal(packed.status, 0, packed.stderr);

  // The tools a person has: Info-ZIP's unzip on Linux, bsdtar (tar.exe) on Windows 10 and later.
  const unpacked = windows
    ? spawnSync('tar', ['-xf', zip, '-C', work], { encoding: 'utf8' })
    : spawnSync('unzip', ['-q', zip, '-d', work], { encoding: 'utf8' });
  assert.equal(unpacked.status, 0, unpacked.stderr);

  for (const file of ['run.sh', 'run.cmd', 'README.md', 'VERSION', 'LICENSE', 'engine/src/main.ts', 'editor/dist/index.html']) {
    assert.ok(existsSync(join(folder, file)), `${file} is in the zip`);
  }
  assert.match(readFileSync(join(folder, 'VERSION'), 'utf8'), /^AI-Graph test\ncommit \S+\nbuilt /);
  // "Permission denied" was every Mac and Linux user's first ./run.sh.
  if (!windows) assert.ok(statSync(join(folder, 'run.sh')).mode & 0o111, 'run.sh is executable once unzipped');
});

test('it starts from its own folder and serves the editor', async () => {
  const run = launch();
  const url = await run.served;
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>/);
  stopTree(run.child);
  await run.ended;
}, { timeout: 90_000 });

test('an editor already on 8000 is not a crash: it takes the next free port', async () => {
  const held = await occupy(8000);
  try {
    const run = launch();
    const url = await run.served;
    assert.notEqual(new URL(url).port, '8000');
    assert.equal((await fetch(url)).status, 200);
    stopTree(run.child);
    await run.ended;
  } finally {
    held?.close();
  }
}, { timeout: 90_000 });

test('a Node that is too old is named, and the launcher stops', async () => {
  const run = launch({ PATH: `${oldNode()}${windows ? ';' : ':'}${currentPath()}` });
  const { code, output } = await run.ended;
  assert.equal(code, 1, output);
  assert.match(output, /needs Node\.js 24 or newer/);
  assert.match(output, /v20\.0\.0/);
}, { timeout: 30_000 });
