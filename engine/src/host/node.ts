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
import { aiService, settingsFromEnv } from '../ai/providers.ts';

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
 * JavaScript and Python take the same contract — `run(inputs)` returning an
 * object — and differ only in the four lines of wrapper that hand the arguments
 * over and print the result. A body sees plain JSON and nothing of this engine,
 * which is what lets the identical body run under the Python engine too.
 */
export const nodeCode: CodeRunner = {
  async run(body, language, inputs, _requirements) {
    const lang = language.toLowerCase();
    const python = lang.startsWith('py');
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-'));
    const file = join(dir, python ? 'body.py' : 'body.mjs');

    const wrapper = python
      ? `${body}\n\nimport json, sys\nprint(json.dumps(run(json.loads(sys.argv[1]))))\n`
      : `${body}\n\nconst __out = await run(JSON.parse(process.argv[2]));\nconsole.log(JSON.stringify(__out));\n`;

    try {
      await writeFile(file, wrapper, 'utf8');
      const command = python ? await pythonCommand() : process.execPath;
      const stdout = await capture(command, [file, JSON.stringify(inputs)]);
      const trimmed = stdout.trim();
      if (!trimmed) throw new Error('the body printed nothing; does it return a dict?');
      return JSON.parse(trimmed.split('\n').pop() as string) as Record<string, unknown>;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

/**
 * Which interpreter runs a Python body.
 *
 * Probed once and remembered, because "python" is not a fact: on this machine
 * it is a Microsoft Store stub that prints an advert and exits, on a Mac it is
 * often absent while python3 is not, and inside a project it is usually a venv
 * nobody put on PATH. `AI_GRAPH_PYTHON` wins when it is set, which is how a
 * caller points at the interpreter its packages are installed in.
 */
let pythonPath: string | null = null;

async function pythonCommand(): Promise<string> {
  if (pythonPath) return pythonPath;
  const candidates = [process.env.AI_GRAPH_PYTHON, 'python3', 'python', 'py'].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const banner = await capture(candidate, ['-c', 'print("ok")']);
      if (banner.trim() === 'ok') {
        pythonPath = candidate;
        return candidate;
      }
    } catch {
      // Try the next one: a missing interpreter is not an error until they all are.
    }
  }
  throw new Error(
    'No Python interpreter found for this code node. Set AI_GRAPH_PYTHON to one, '
    + 'or write the body in JavaScript, which needs nothing installed.',
  );
}

function capture(command: string, args: string[]): Promise<string> {
  return new Promise((fulfil, fail) => {
    const child = spawn(command, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      if (code === 0) fulfil(out);
      // The last line of a traceback is the sentence a person needs; the rest
      // is where it happened, which matters second.
      else fail(new Error(err.trim().split('\n').slice(-3).join('\n') || `exited with ${code}`));
    });
  });
}

/**
 * The engine wired to this machine.
 *
 * The model provider is configured from the environment, the same variable
 * names the Python engine reads, so one machine's configuration serves both
 * while they coexist.
 */
export function nodeRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    files: nodeFiles,
    code: nodeCode,
    ai: aiService(settingsFromEnv(process.env)),
    ...overrides,
  };
}

export { sep as pathSeparator };
