// Running a graph from a command line.
//
//     node src/main.ts graph.json                     once
//     node src/main.ts graph.json --inputs key=value  answering what it asks
//     node src/main.ts graph.json --every 5m           again, after each run
//     node src/main.ts graph.json --bundle ./out       hand it to someone else
//     node src/main.ts graph.json --serve             open its page in a browser
//
// The same entry point a bundle uses, so what someone receives is the thing
// that was tested rather than a second launcher written for them. It is also
// what `deno compile` turns into a single file with nothing to install.
//
// One rule about the two streams, learned the hard way in the older runner:
// **stdout is the result and nothing else.** Questions, progress and errors go
// to stderr, so `run graph.json | jq` works. A prompt printed to stdout put
// "Text for 'Greeting': " in front of the JSON and nobody could parse it.

import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseGraph } from './graph.ts';
import { executeGraph } from './executor.ts';
import { registry } from './registry.ts';
import { nodeRuntime } from './host/node.ts';
import { applyRuntimeValues, runtimeRequirements, type RuntimeRequirement } from './runtimeValues.ts';
import { writeBundle } from './bundle.ts';
import { serve } from './host/serve.ts';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

export interface CliOptions {
  graphPath: string;
  inputs: Record<string, string>;
  /** Seconds between the end of one run and the start of the next. */
  every?: number;
  /** Stop after this many runs. Undefined means keep going. */
  limit?: number;
  /** Write a runnable copy here instead of running it. */
  bundle?: string;
  /** Serve this graph's page instead of running it once. */
  serve?: boolean;
  port?: number;
}

/**
 * `45`, `30s`, `5m`, `2h`, `1d` — seconds when it is only a number.
 *
 * Bare numbers are seconds because that is what "interval" means everywhere
 * else here; the suffixes exist so nobody has to multiply by 86400 to say "a
 * day" and get it wrong at three in the morning.
 */
export function parseInterval(text: string): number {
  const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(text.trim());
  if (!match) throw new Error(`Not an interval: ${text}. Use 45, 30s, 5m, 2h or 1d.`);
  const scale = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2]] ?? 1;
  const seconds = Number(match[1]) * scale;
  if (seconds <= 0) throw new Error('An interval must be greater than zero.');
  return seconds;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { graphPath: '', inputs: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--inputs') {
      const [key, ...rest] = (argv[++i] ?? '').split('=');
      if (key) options.inputs[key] = rest.join('=');
    } else if (arg === '--every') {
      options.every = parseInterval(argv[++i] ?? '');
    } else if (arg === '--limit') {
      options.limit = Number(argv[++i]);
    } else if (arg === '--bundle') {
      options.bundle = argv[++i] ?? 'bundle';
    } else if (arg === '--serve') {
      options.serve = true;
    } else if (arg === '--port') {
      options.port = Number(argv[++i]);
    } else if (!options.graphPath) {
      options.graphPath = arg;
    }
  }
  if (!options.graphPath) options.graphPath = 'graph.json';
  return options;
}

/** Ask for anything the graph needs, falling back to what it already holds. */
async function answer(
  asked: RuntimeRequirement[],
  given: Record<string, string>,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = { ...given };
  const interactive = process.stdin.isTTY;
  const reader = interactive ? createInterface({ input: process.stdin, output: process.stderr }) : null;

  try {
    for (const requirement of asked) {
      if (resolved[requirement.key]) continue;
      if (!reader) {
        if (!requirement.current) {
          throw new Error(
            `Missing a value for '${requirement.label}' and nothing is available to ask. `
            + `Pass --inputs ${requirement.key}=…`,
          );
        }
        resolved[requirement.key] = requirement.current;
        continue;
      }
      const suffix = requirement.current ? ` [${requirement.current}]` : '';
      const typed = (await reader.question(`${requirement.label}${suffix}: `)).trim();
      resolved[requirement.key] = typed || requirement.current;
    }
  } finally {
    reader?.close();
  }
  return resolved;
}

export async function runOnce(options: CliOptions): Promise<number> {
  const graph = parseGraph(JSON.parse(await readFile(options.graphPath, 'utf8')));
  applyRuntimeValues(graph, await answer(runtimeRequirements(graph, registry), options.inputs), registry);

  const runtime = nodeRuntime({
    report: (event) => {
      if (event.type === 'batch') process.stderr.write(`\r  ${event.done}/${event.total}`);
      if (event.type === 'node_done' && event.status === 'error') {
        process.stderr.write(`\n  ${event.node_id} failed\n`);
      }
    },
  });

  const result = await executeGraph(graph, { runtime, registry });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'error' ? 1 : 0;
}

/**
 * Run repeatedly, *interval* seconds apart.
 *
 * Measured between the end of one run and the start of the next, not between
 * starts: a graph that takes longer than its interval would otherwise pile
 * runs on top of each other until something gives.
 */
export async function runEvery(options: CliOptions): Promise<number> {
  const seconds = options.every ?? 0;
  let code = 0;
  for (let round = 0; options.limit === undefined || round < options.limit; round += 1) {
    if (round > 0) {
      process.stderr.write(`\nWaiting ${seconds}s…\n`);
      await new Promise((wake) => setTimeout(wake, seconds * 1000));
    }
    code = await runOnce(options);
  }
  return code;
}

/** Write the graph and the engine somewhere someone else can run them. */
export async function makeBundle(options: CliOptions): Promise<number> {
  const graph = parseGraph(JSON.parse(await readFile(options.graphPath, 'utf8')));
  const written = await writeBundle(graph, options.bundle!);
  process.stderr.write(
    `Wrote ${written.length} files to ${options.bundle}
`
    + `Run it there with:  ./run.sh    (run.cmd on Windows)
`,
  );
  return 0;
}

/**
 * Serve the page and wait.
 *
 * The page directory is `page/` beside the graph — where a bundle puts it —
 * and its absence is not an error: a graph with no interface, or a bundle
 * written without a build at hand, still serves its few endpoints, which is
 * enough for anything driving it over HTTP.
 */
export async function runServer(options: CliOptions): Promise<number> {
  // No graph file is a legitimate way to run this. The editor starts it beside
  // itself purely to execute, and posts the graph being edited with every
  // request; a bundle is the other case, and there the graph is right here.
  const hasGraph = existsSync(resolve(options.graphPath));
  const pageDir = resolve(dirname(resolve(options.graphPath)), 'page');

  const { url } = await serve({
    ...(hasGraph ? { graphPath: options.graphPath } : {}),
    pageDir: existsSync(join(pageDir, 'runtime.html')) ? pageDir : undefined,
    port: options.port ?? 8000,
  });
  process.stderr.write(`Serving on ${url}\n`);
  // Opening a browser is for a tool someone was handed, not for a helper the
  // editor started.
  if (hasGraph) await open(url);
  // Nothing to await: the server holds the process open until it is stopped.
  return new Promise(() => {});
}

/** Show the tool, if this machine has something to show it in. */
async function open(url: string): Promise<void> {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // A headless machine is a fine place to serve from; the URL is printed.
  }
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.bundle) return makeBundle(options);
  if (options.serve) return runServer(options);
  return options.every ? runEvery(options) : runOnce(options);
}
