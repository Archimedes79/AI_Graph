// Running a graph from a command line.
//
//     node src/main.ts graph.json                     once
//     node src/main.ts my_project/                    the same, for a project folder
//     node src/main.ts check my_project/ other.json   what is wrong, without running
//     node src/main.ts test my_project/ --offline     run the nodes' examples.md
//     node src/main.ts run-node my_project/ count     one node, on what feeds it (or '{"input": …}')
//     node src/main.ts graph.json --inputs key=value  answering what it asks
//     node src/main.ts graph.json --every 5m           again, after each run
//     node src/main.ts graph.json --bundle ./out       hand it to someone else
//     node src/main.ts graph.json --serve             open its page in a browser
//     node src/main.ts --editor editor/dist          the editor itself, on :8000
//     node src/main.ts --mcp --mcp-root ./project     graph tools for an assistant, on stdio
//
// The same entry point a bundle uses, so what someone receives is the thing
// that was tested rather than a second launcher written for them. It is also
// what `deno compile` turns into a single file with nothing to install.
//
// One rule about the two streams, learned the hard way in the older runner:
// **stdout is the result and nothing else.** Questions, progress and errors go
// to stderr, so `run graph.json | jq` works. A prompt printed to stdout put
// "Text for 'Greeting': " in front of the JSON and nobody could parse it.

import { createInterface } from 'node:readline/promises';
import type { Graph } from '../graph.ts';
import { loadGraph, projectFolderOf } from '../project/folder.ts';
import { checkPath } from '../project/check.ts';
import { executeGraph, executeNode, inputsFor, nodeName } from '../execution/executor.ts';
import { runExamples } from '../execution/examples.ts';
import { registry } from '../elements/registry.ts';
import { nodeRuntime } from '../host/node.ts';
import { applyRuntimeValues, runtimeRequirements, type RuntimeRequirement } from '../execution/runtimeValues.ts';
import { writeBundle } from './bundle.ts';
import { portTaken, serve } from '../host/serve.ts';
import { untilStopped } from '../host/lifecycle.ts';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphTriggers, parseInterval } from '../execution/triggers.ts';

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
  /** Serve the built editor from this folder. */
  editor?: string;
  /** Bind address. Loopback unless said otherwise; see `serve` for what that switches off. */
  host?: string;
  port?: number;
  /** Be an MCP server on stdio instead of running anything: see `host/editor/mcpServer.ts`. */
  mcp?: boolean;
  /** The one folder that server may touch. Where it was started, unless said otherwise. */
  mcpRoot?: string;
}

// The interval spelling lives with the triggers now: a graph can name its own
// clock, and the page that serves it reads the same `5m` this flag does.
export { parseInterval };

/** Where a served tool looks first. Nothing addresses it from outside, so this is a habit, not a contract. */
const DEFAULT_PORT = 8000;
/** How many in a row to try before a busy machine is the user's problem to sort out. */
const PORTS_TRIED = 10;

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
      // Checked here rather than at `listen`, which answers a mistyped port
      // with ERR_SOCKET_BAD_PORT and a stack.
      const given = argv[++i] ?? '';
      const port = Number(given);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`--port wants a number from 1 to 65535, not "${given}".`);
      }
      options.port = port;
    } else if (arg === '--editor') {
      options.editor = argv[++i] ?? 'editor/dist';
    } else if (arg === '--host') {
      options.host = argv[++i] ?? '';
    } else if (arg === '--mcp') {
      options.mcp = true;
    } else if (arg === '--mcp-root') {
      options.mcpRoot = argv[++i] ?? '';
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
  const graph = await loadGraph(options.graphPath);
  applyRuntimeValues(graph, await answer(runtimeRequirements(graph, registry), options.inputs), registry);

  const runtime = nodeRuntime({
    report: (event) => {
      if (event.type === 'batch') process.stderr.write(`\r  ${event.done}/${event.total}`);
      if (event.type === 'node_done' && event.status === 'error') {
        const node = graph.nodes.find((n) => n.id === event.node_id);
        process.stderr.write(`\n  ${node ? nodeName(node) : event.node_id} failed\n`);
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
  const graph = await loadGraph(options.graphPath);
  // The built page, when this checkout has one. A bundle without it still
  // runs on the terminal; with it, the recipient gets the tool they were
  // shown. Looked up rather than passed, because the person writing a bundle
  // should not have to know where a build lands.
  const built = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'editor', 'dist');
  const written = await writeBundle(graph, options.bundle!, {
    pageDir: existsSync(join(built, 'runtime.html')) ? built : undefined,
  });
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
 *
 * Without `--port` it takes the first free port from 8000 up. A tool someone
 * was handed is started by double-clicking it, and "the port I chose happens
 * to be taken on your machine" is not a thing its recipient should ever have
 * to know about, let alone read a Node stack trace about.
 */
export async function runServer(options: CliOptions): Promise<number> {
  // No graph file is a legitimate way to run this. The editor starts it beside
  // itself purely to execute, and posts the graph being edited with every
  // request; a bundle is the other case, and there the graph is right here.
  const hasGraph = existsSync(resolve(options.graphPath));
  // Beside the graph file, or inside the project folder: where a bundle puts it.
  const folder = projectFolderOf(options.graphPath);
  const pageDir = folder ? join(folder, 'page') : resolve(dirname(resolve(options.graphPath)), 'page');

  const start = (port: number) => serve({
    ...(hasGraph ? { graphPath: options.graphPath } : {}),
    pageDir: existsSync(join(pageDir, 'runtime.html')) ? pageDir : undefined,
    port,
    ...(options.editor ? { editor: { dist: resolve(options.editor) } } : {}),
    ...(options.host ? { host: options.host } : {}),
  });

  // A tool someone was handed must not die because a port is busy. The
  // default is 8000 because it has to be something, not because it matters:
  // nothing addresses this server from outside, the URL is printed and
  // opened, so the next free port does just as well. A port asked for by name
  // is different -- it was asked for -- and a busy one is said in a sentence
  // rather than as an unhandled 'error' event over a stack trace, which is
  // what a recipient running a bundle on a machine with anything on 8000 saw.
  const { url, shutdown } = await (async () => {
    if (options.port !== undefined) {
      try {
        return await start(options.port);
      } catch (error) {
        if (!portTaken(error)) throw error;
        throw new Error(
          `Port ${options.port} is already in use: something else on this machine is listening there.`
          + ' Start it on another one, for example --port 8010.',
        );
      }
    }
    for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORTS_TRIED; port += 1) {
      try {
        return await start(port);
      } catch (error) {
        if (!portTaken(error)) throw error;
      }
    }
    // Rather than a silent 0: a machine with ten busy ports in a row is one
    // where "it picked another" would be a guess nobody can check.
    throw new Error(
      `Ports ${DEFAULT_PORT} to ${DEFAULT_PORT + PORTS_TRIED - 1} are all in use.`
      + ' Free one, or say which to use with --port.',
    );
  })();
  process.stderr.write(`Serving on ${url}\n`);
  // Only the editor: a deployed tool is configured by whoever runs it, and its
  // terminal is a log rather than something a person is sitting in front of.
  if (options.editor) {
    // Imported here for the reason `runMcp` gives: a bundle has no `editor/`.
    const { setupLines } = await import('../host/editor/settings.ts');
    for (const line of await setupLines()) process.stderr.write(`${line}\n`);
  }
  // Opening a browser is for something a person starts -- a tool they were
  // handed, or the editor -- not for a helper another process started.
  if (hasGraph || options.editor) await open(url);
  // The server holds the process open until someone asks it to stop. Then the
  // runs in flight are ended rather than abandoned, and the code is returned so
  // the process ends by itself (see main.ts). Should something still hold it
  // open after that, it is not something worth waiting for.
  const code = await untilStopped(shutdown);
  setTimeout(() => process.exit(code), 2000).unref();
  return code;
}

/** Show the tool, if this machine has something to show it in. */
async function open(url: string): Promise<void> {
  // For CI, a container, and a helper another process started: nothing to
  // open a browser in, and the attempt is only noise.
  if (process.env.AI_GRAPH_NO_BROWSER) return;
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // A headless machine is a fine place to serve from; the URL is printed.
  }
}

/**
 * Be an MCP server until the client hangs up.
 *
 * Imported here and not at the top: the server is authoring, it lives under an
 * `editor/` folder, and a bundle leaves every one of those behind. A static
 * import would make each bundle fail on a file it was never meant to have.
 */
export async function runMcp(options: CliOptions): Promise<number> {
  let server: typeof import('../host/editor/mcpServer.ts');
  try {
    server = await import('../host/editor/mcpServer.ts');
  } catch (error) {
    if ((error as { code?: string })?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error('This copy of the engine has no MCP server: it is part of the editor, which a bundle does not carry.');
  }
  await server.runMcpServer({ root: options.mcpRoot || undefined });
  return 0;
}

/**
 * Say what is wrong with each graph or project, without running anything.
 * The result on stdout, one problem per paragraph; exit code 1 when there is
 * any, so a CI job fails on a broken graph before anyone opens it.
 */
export async function runCheck(paths: string[]): Promise<number> {
  let failed = 0;
  for (const path of paths.length ? paths : ['.']) {
    const { problems, graph } = await checkPath(path);
    if (!problems.length) {
      process.stdout.write(`✓ ${path}: ${graph!.nodes.length} nodes, ${graph!.edges.length} edges\n`);
      continue;
    }
    failed += 1;
    process.stdout.write(`✗ ${path}: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`);
    for (const { where, problem, fix } of problems) process.stdout.write(`  ${where}: ${problem}\n    → ${fix}\n`);
  }
  return failed ? 1 : 0;
}

/**
 * Run the examples every node keeps in its examples.md, or one node's with
 * `--node`. `--offline` asks no model: an AI node's examples and every judged
 * expectation are skipped, which is how CI runs them. Exit code 1 when one fails.
 */
export async function runTests(argv: string[]): Promise<number> {
  const offline = argv.includes('--offline');
  const only = argv.includes('--node') ? argv[argv.indexOf('--node') + 1] : '';
  const paths = argv.filter((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--node');
  let failed = 0;
  for (const path of paths.length ? paths : ['.']) {
    let tested = 0;
    // A node that holds a graph holds nodes with examples of their own, and
    // they are tested here for the same reason `check` descends: the graph
    // inside is part of this project, not a second one.
    for (const { graph, inside } of everyGraphIn(await loadGraph(path))) {
      const nodes = graph.nodes.filter((node) => (only ? node.id === only : String(node.config.examples ?? '').trim()));
      tested += nodes.length;
      for (const node of nodes) {
        for (const result of await runExamples(graph, node.id, { runtime: nodeRuntime(), registry, offline })) {
          const mark = { pass: '✓', fail: '✗', error: '✗', skipped: '·' }[result.status];
          process.stdout.write(`${mark} ${path} ${inside}${node.id}: ${result.title}${result.status === 'skipped' ? ' (skipped)' : ''}\n`);
          for (const line of result.status === 'skipped' ? [] : result.details) process.stdout.write(`    ${line}\n`);
          if (result.status === 'fail' || result.status === 'error') failed += 1;
        }
      }
    }
    if (!tested) process.stdout.write(`· ${path}: ${only ? `no node "${only}"` : 'no node has examples'}\n`);
  }
  return failed ? 1 : 0;
}

/** The graph loaded, and every graph its nodes hold, with the way down to each. */
function everyGraphIn(graph: Graph, inside = ''): { graph: Graph; inside: string }[] {
  return [
    { graph, inside },
    ...graph.nodes.flatMap((node) => {
      const held = registry.node(node.node_type)?.nestedGraph(node);
      return held ? everyGraphIn(held, `${inside}${node.id} ▸ `) : [];
    }),
  ];
}

/**
 * Run one node by itself and print what it returned: on the inputs given as
 * JSON, or -- without them -- on what the nodes feeding it produce, which are
 * run for that and nothing else.
 */
export async function runNodeCommand([path, nodeId, given]: string[]): Promise<number> {
  if (!path || !nodeId) throw new Error('Usage: run-node <graph or project> <node id> [\'{"port": value}\']');
  const graph = await loadGraph(path);
  applyRuntimeValues(graph, {}, registry);
  const inputs = given
    ? JSON.parse(given) as Record<string, unknown>
    : (await inputsFor(graph, nodeId, { runtime: nodeRuntime(), registry })).inputs;
  const result = await executeNode(graph, nodeId, inputs, { runtime: nodeRuntime(), registry });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'error' ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'check') return runCheck(argv.slice(1));
  if (argv[0] === 'test') return runTests(argv.slice(1));
  if (argv[0] === 'run-node') return runNodeCommand(argv.slice(1));
  const options = parseArgs(argv);
  // First, and needing no graph: nothing below may get the chance to write a
  // line to stdout, which from here on belongs to the protocol.
  if (options.mcp) return runMcp(options);
  if (options.bundle) return makeBundle(options);
  if (options.serve || options.editor) return runServer(options);
  // The graph's own clock, when the command line names none: a graph saved as
  // "every 5 minutes" is that on any machine, not only where someone remembers
  // the flag. `--every` still wins, which is how one run is made of it.
  if (!options.every && existsSync(resolve(options.graphPath))) {
    const graph = await loadGraph(options.graphPath);
    // Its shortest interval: on the command line a round is the whole graph,
    // every trigger counted as fired, so one clock is all there is to keep.
    const intervals = graphTriggers(graph).filter((trigger) => trigger.every).map((trigger) => parseInterval(trigger.every));
    if (intervals.length) options.every = Math.min(...intervals);
  }
  return options.every ? runEvery(options) : runOnce(options);
}
