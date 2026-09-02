// The engine on a machine with a filesystem: Node today, Deno unchanged.
//
// This is the only file in the engine that knows an operating system exists.
// Everything above it takes a `Runtime` and therefore also runs in a browser
// tab, or in a test with three fakes, without knowing the difference — which is
// the whole reason the services are passed in rather than imported.

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import type { CodeRunner, FileService, Runtime } from '../element.ts';
import { aiService } from '../ai/providers.ts';
import { configuredSettings } from '../ai/settings.ts';

export const nodeFiles: FileService = {
  resolve: (path: string) => resolve(path),
  exists: async (path: string) => existsSync(path),
  async read(path: string, mode: 'text' | 'binary' = 'text') {
    if (mode === 'binary') return (await readFile(path)).toString('base64');
    return readFile(path, 'utf8');
  },
  async write(path: string, content: string, mode: 'text' | 'binary' = 'text') {
    await writeFile(path, mode === 'binary' ? Buffer.from(content, 'base64') : content);
  },
  async list(path: string, options = {}) {
    const { recursive = false, extensions } = options;
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (recursive) await walk(full);
        } else if (!extensions || extensions.includes(extname(entry.name).toLowerCase())) {
          found.push(full);
        }
      }
    };
    if ((await stat(path)).isDirectory()) await walk(path);
    // Sorted, because a directory listing is an input: two runs over the same
    // folder must hand the graph the same order or nothing downstream is
    // reproducible.
    return found.sort();
  },
};

/**
 * Running an authored body.
 *
 * A separate process, not `eval`: a body that loops forever, exits, or writes
 * to stdout costs a subprocess rather than the run. It sees plain JSON on argv
 * and nothing of this engine, so nothing about how the graph executes leaks
 * into what someone writes.
 *
 * The interpreter is the one already running this engine. That is the whole
 * reason bodies are JavaScript: a recipient who can run the engine can run
 * every body in it, with no interpreter to find and no packages to install.
 */
/**
 * What a body is allowed to do, as flags to its own interpreter.
 *
 * Node's permission system denies everything once it is on, so what is listed
 * here is the whole list. Files stay open — reading and writing them is most
 * of what a body is *for*, and a graph that cannot touch a file is a graph
 * that cannot do its job.
 *
 * What closes: starting other programs, loading native addons, spawning
 * worker threads, opening a debugger port. A body has no business doing any
 * of those, and a generated one is run by the sweep before anybody has read
 * it.
 *
 * What this does **not** close is the network: Node has no flag for it (Deno
 * does). A body can still reach out. Worth knowing rather than assuming.
 */
const SANDBOX = ['--permission', '--allow-fs-read=*', '--allow-fs-write=*'];

export const nodeCode: CodeRunner = {
  async run(body, inputs) {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-'));
    const file = join(dir, 'body.mjs');

    const wrapper = `${body}\n\nconst __out = await run(JSON.parse(process.argv[2]));\nconsole.log(JSON.stringify(__out));\n`;

    try {
      await writeFile(file, wrapper, 'utf8');
      const stdout = await capture(process.execPath, [...SANDBOX, file, JSON.stringify(inputs)]);
      const trimmed = stdout.trim();
      if (!trimmed) throw new Error('the body printed nothing; does it return an object?');
      return JSON.parse(trimmed.split('\n').pop() as string) as Record<string, unknown>;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

function capture(command: string, args: string[]): Promise<string> {
  return new Promise((fulfil, fail) => {
    const child = spawn(command, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      if (code === 0) return fulfil(out);
      // The sentence a person needs is the one naming the error. A thrown
      // error puts it at the bottom of the traceback; a syntax error puts it
      // near the top, above the stack -- so it is looked for, not assumed.
      const lines = err.trim().split('\n');
      const named = lines.findIndex((line) => /^\w*Error\b/.test(line.trim()));
      const message = named >= 0 ? lines.slice(named, named + 2).join('\n') : lines.slice(-3).join('\n');
      fail(new Error(message.trim() || `exited with ${code}`));
    });
  });
}

/**
 * The engine wired to this machine.
 *
 * The model provider is configured from the environment and the settings
 * file, so a double-clicked build is configurable without a terminal.
 */
export function nodeRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    files: nodeFiles,
    code: nodeCode,
    ai: aiService(configuredSettings()),
    ...overrides,
  };
}

export { sep as pathSeparator };
