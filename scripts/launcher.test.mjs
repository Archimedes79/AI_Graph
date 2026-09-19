// What the launcher promises, tried against a real editor: `node --test scripts/`.
//
// Not a unit test. The three things that went wrong on a real machine were a
// fresh checkout that never installed, a second start that left the first
// server running, and a stop that ended whatever happened to be on the port --
// and none of them can be seen without starting the thing. So these tests run
// start.mjs and stop.mjs as a person does, on a port nothing else uses.
//
// The first test installs and builds when the checkout has not yet, which is
// the fresh-checkout case and is also why it is given ten minutes.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAiGraph, isListening, listenerPids } from './editorProcess.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Out of the way of the editor a person has open on 8000, and of the examples' ports. */
const PORT = 8731;
const START = join(root, 'scripts', 'start.mjs');
const STOP = join(root, 'scripts', 'stop.mjs');

/** Every child this file started, so a failure halfway leaves nothing behind. */
const started = [];

function launch() {
  const child = spawn(process.execPath, [START, '--port', String(PORT)], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, AI_GRAPH_NO_BROWSER: '1' },
  });
  started.push(child);
  return child;
}

const stop = (...args) => spawnSync(process.execPath, [STOP, ...args], { cwd: root, encoding: 'utf8' });

/** Wait until *ready* answers true, or give up after *seconds*. */
async function until(ready, seconds) {
  for (let waited = 0; waited < seconds * 10; waited += 1) {
    if (await ready()) return true;
    await new Promise((wake) => setTimeout(wake, 100));
  }
  return false;
}

after(async () => {
  stop('--port', String(PORT));
  for (const child of started) child.kill();
});

test('starts, installing and building whatever the checkout is missing', async () => {
  launch();
  assert.ok(await until(() => isAiGraph(PORT), 600), `nothing answered as AI-Graph on ${PORT}`);
}, { timeout: 620_000 });

test('starting again replaces the editor instead of failing on a taken port', async () => {
  // By pid, not by "something answers": the first editor answers throughout,
  // and a start that quietly did nothing would pass any weaker test.
  const before = listenerPids(PORT);
  assert.ok(before.length, 'the first editor is listening');

  launch();
  const replaced = await until(
    async () => {
      const now = listenerPids(PORT);
      return now.length > 0 && now.every((pid) => !before.includes(pid)) && await isAiGraph(PORT);
    },
    300,
  );
  assert.ok(replaced, 'the port is still held by the first editor');
}, { timeout: 320_000 });

test('stops it, and says so plainly when there is nothing to stop', async () => {
  const first = stop('--port', String(PORT));
  assert.equal(first.status, 0);
  assert.match(first.stdout, /Editor stopped\./);
  assert.equal(await isListening(PORT), false);

  const again = stop('--port', String(PORT));
  assert.equal(again.status, 0, 'stopping nothing is not a failure');
  assert.match(again.stdout, new RegExp(`No editor is running on port ${PORT}`));
});

test('refuses to end a program on that port that is not AI-Graph', async () => {
  // The reason the check exists: the launcher used to end whatever held the
  // port, which on 8000 is somebody's database as often as it is the editor.
  const stranger = createServer((_request, response) => response.end('not me'));
  await new Promise((listening) => stranger.listen(PORT, '127.0.0.1', listening));
  try {
    const refused = stop('--port', String(PORT));
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /not AI-Graph/);
    assert.ok(stranger.listening, 'the stranger is still running');
  } finally {
    await new Promise((closed) => stranger.close(closed));
  }
});

test('turns down a port that is not one', () => {
  const refused = stop('--port', 'eight thousand');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Invalid port/);
});
