import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * `docker stop`, a supervisor, `kill`: SIGTERM to the real process.
 *
 * Not on Windows, which has no such signal -- `kill()` there ends the process
 * where it stands and proves nothing. Ctrl+C is the Windows case; it reaches
 * the same handler, and was tried by hand with a console event.
 */

const MAIN = resolve(__dirname, '..', 'main.ts');
const SLOW = 'async function run() { await new Promise((r) => setTimeout(r, 60000)); return { out: 1 }; }';

const freePort = () => new Promise<number>((found) => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => found(port));
  });
});

describe('a served tool that is told to stop', () => {
  it.skipIf(process.platform === 'win32')('ends the round in flight, keeps the last one that finished, and exits 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stop-'));
    const graphPath = join(dir, 'graph.json');
    await writeFile(graphPath, JSON.stringify({
      metadata: { name: 'slow' },
      nodes: [{ id: 'start', node_type: 'trigger', config: { trigger_on_start: true } }, { id: 'slow', node_type: 'code', inputs: [], outputs: [{ id: 'out', name: 'out' }], config: { code: SLOW } }],
      edges: [],
    }));
    const kept = `${graphPath}.last-run.json`;
    const before = JSON.stringify({ runs: 3, result: { status: 'success', node_results: [], outputs: {} }, error: null, finished_at: 1 });
    await writeFile(kept, before);

    const port = await freePort();
    const server = spawn(process.execPath, [MAIN, graphPath, '--serve', '--port', String(port)], {
      env: { ...process.env, AI_GRAPH_NO_BROWSER: '1' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let said = '';
    server.stderr.on('data', (chunk: Buffer) => { said += chunk.toString(); });
    const exited = new Promise<number | null>((done) => server.on('exit', (code) => done(code)));

    try {
      // Up, and its round is in flight: the state a stop has to cope with.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const state = await fetch(`http://127.0.0.1:${port}/api/runtime/last`).then((r) => r.json()).catch(() => null) as { running?: boolean } | null;
        if (state?.running) break;
        await new Promise((wake) => setTimeout(wake, 100));
      }
      const asked = Date.now();
      server.kill('SIGTERM');
      expect(await exited).toBe(0);
      expect(Date.now() - asked).toBeLessThan(8000);
      expect(said).toContain('Stopping');
      expect(await readFile(kept, 'utf8')).toBe(before);
    } finally {
      server.kill('SIGKILL');
    }
  }, 40_000);
});
