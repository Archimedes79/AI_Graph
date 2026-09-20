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
import type { CodeRunner, FileService, Runtime } from '../elements/Runtime.ts';
import { aiService } from '../ai/providers.ts';
import { mcpToolService } from '../ai/mcp.ts';
import { configuredMcpServers, configuredSettings } from '../ai/settings.ts';

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

/**
 * What marks a line on a body's stdout as the wrapper's own: a question for
 * this process, or the result. Anything else a body prints is its own business
 * and is ignored -- it used to be able to break the result by logging after it.
 */
const MARK = '\u001eai-graph:';

export const nodeCode: CodeRunner = {
  async run(body, inputs, signal, context) {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-'));
    const file = join(dir, 'body.mjs');

    // A body runs as an ES module, where `require` does not exist. A body that
    // used it failed with ERR_AMBIGUOUS_MODULE_SYNTAX -- a message about module
    // formats, raised because the wrapper's top-level await left Node unsure
    // which format was meant, for someone who had only asked for a file to be
    // read. Both styles are ordinary JavaScript and both come out of a model,
    // so both work: the bridge below defines `require`, and `import` needs
    // nothing.
    const lead = "import { createRequire } from 'node:module';\n"
      + "import { createInterface as __lines } from 'node:readline';\n"
      + 'const require = createRequire(import.meta.url);\n'
      // The inputs arrive on stdin, not as an argument. A command line has a
      // ceiling -- about 32 KB on Windows -- and a wired file is an input like
      // any other: a 100 KB log failed with `spawn ENAMETOOLONG`, a message
      // about creating processes, for someone who had wired a CSV into a node.
      //
      // One line in, then one line per answer: a body may ask the process that
      // started it for what it is not allowed itself (`BodyContext.calls`), by
      // printing a marked line and waiting for the reply with its number.
      + 'const __stdin = __lines({ input: process.stdin })[Symbol.asyncIterator]();\n'
      + 'const __given = JSON.parse((await __stdin.next()).value);\n'
      + 'const __asked = new Map();\nlet __count = 0;\n'
      + '(async () => { for (;;) { const { value, done } = await __stdin.next(); if (done) return; '
      + 'const reply = JSON.parse(value); const waiting = __asked.get(reply.id); __asked.delete(reply.id); '
      + "if (waiting) ('error' in reply ? waiting.fail(new Error(reply.error)) : waiting.ok(reply.result)); } })();\n"
      + 'const __ask = (name) => (args) => new Promise((ok, fail) => { const id = ++__count; '
      + `__asked.set(id, { ok, fail }); process.stdout.write(${JSON.stringify(MARK)} + 'call ' + JSON.stringify({ id, name, args: args ?? null }) + '\\n'); });\n`
      + 'const __node = { ...__given.data, ...Object.fromEntries(__given.calls.map((name) => [name, __ask(name)])) };\n\n';
    const tail = '\n\nconst __out = await run(__given.inputs, __node);\n'
      + `process.stdout.write(${JSON.stringify(MARK)} + 'result ' + JSON.stringify(__out ?? null) + '\\n', () => process.stdin.unref?.());\n`;
    const wrapper = `${lead}${body}${tail}`;

    try {
      await writeFile(file, wrapper, 'utf8');
      const given = { inputs, data: context?.data ?? {}, calls: Object.keys(context?.calls ?? {}) };
      const result = await converse(process.execPath, [...SANDBOX, file], JSON.stringify(given), context?.calls ?? {}, signal);
      if (result === undefined) throw new Error('the body returned nothing; does it return an object?');
      if (result === null || typeof result !== 'object') throw new Error('the body must return an object keyed by output port.');
      return result as Record<string, unknown>;
    } catch (error) {
      throw inBodyLines(error, lead);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

/**
 * A failure in the body, counted in the body's own lines.
 *
 * Node reports `/tmp/ai-graph-x9/body.mjs:7:24` -- a file that is deleted
 * before anyone reads the message, at a line the wrapper above moved. The
 * person looking at the error wrote line 1 of a body, and that is what it now
 * says.
 */
function inBodyLines(error: unknown, lead: string): unknown {
  if (!(error instanceof Error)) return error;
  const offset = lead.split('\n').length - 1;
  error.message = error.message.replace(
    /\S*body\.mjs:(\d+)(?::(\d+))?/g,
    (whole, line: string, column?: string) => {
      const inBody = Number(line) - offset;
      return inBody > 0 ? `line ${inBody}${column ? `, column ${column}` : ''}` : whole;
    },
  );
  return error;
}

/**
 * Run the body's process and hold up this end of the conversation: hand it its
 * inputs, answer what it asks, and return what it says its result is.
 */
function converse(
  command: string,
  args: string[],
  given: string,
  calls: Record<string, (args: unknown) => Promise<unknown>>,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((fulfil, fail) => {
    if (signal?.aborted) return fail(new Error('Stopped.'));
    const child = spawn(command, args, { windowsHide: true });
    // Text, decoded across chunk boundaries: a line is split on, and a character must not be.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // Stop means stop: a body in a loop is a process, and a process can be ended.
    const stop = () => { child.kill(); };
    signal?.addEventListener('abort', stop, { once: true });
    child.on('close', () => signal?.removeEventListener('abort', stop));
    // A body that exits before reading its input closes the pipe under the
    // write. That is the body's failure, and its exit code reports it.
    child.stdin.on('error', () => {});
    const say = (line: string): void => { if (child.stdin.writable) child.stdin.write(`${line}\n`); };
    say(given);
    // Nothing it could ask: nothing more to say, and an open pipe would only
    // keep a body alive that forgot to return.
    if (!Object.keys(calls).length) child.stdin.end();

    let result: unknown;
    let answered = false;
    let pending = '';
    let err = '';

    const answer = async (asked: { id: number; name: string; args: unknown }): Promise<void> => {
      const call = calls[asked.name];
      try {
        if (!call) throw new Error(`This body may not ask for "${asked.name}".`);
        say(JSON.stringify({ id: asked.id, result: (await call(asked.args)) ?? null }));
      } catch (error) {
        say(JSON.stringify({ id: asked.id, error: error instanceof Error ? error.message : String(error) }));
      }
    };

    child.stdout.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith(MARK)) continue;
        const rest = line.slice(MARK.length);
        if (rest.startsWith('call ')) void answer(JSON.parse(rest.slice(5)));
        if (rest.startsWith('result ')) {
          result = JSON.parse(rest.slice(7));
          answered = true;
          child.stdin.end();
        }
      }
    });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      if (code === 0) return fulfil(answered ? result : undefined);
      if (signal?.aborted) return fail(new Error('Stopped.'));
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
 *
 * Tool servers come from the settings file and from nowhere else. A graph
 * names the servers it wants; which program a name starts is this machine's
 * decision, never the graph's -- `ai/mcp.ts` is where that line is held.
 * Nothing is started here: a server runs for the length of one node's run.
 */
export function nodeRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    files: nodeFiles,
    code: nodeCode,
    ai: aiService(configuredSettings()),
    tools: mcpToolService(configuredMcpServers()),
    ...(Number(process.env.AI_GRAPH_MAX_LLM_CALLS) > 0 ? { llmCallsPerBody: Number(process.env.AI_GRAPH_MAX_LLM_CALLS) } : {}),
    ...overrides,
  };
}

export { sep as pathSeparator };
