// Running a graph from a command line.
//
//     node src/main.ts graph.json                     once
//     node src/main.ts my_project/                    the same, for a project folder
//     node src/main.ts check my_project/ other.json   what is wrong, without running
//     node src/main.ts test my_project/ --offline     each node on its input.js, held to its output.js
//     node src/main.ts run-node my_project/ count     one node, on its input.js (or '{"input": …}')
//     node src/main.ts graph.json --value name=text  a value it takes, by name
//     node src/main.ts graph.json --event go          the round one event starts
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
import { frontendOf, loadGraph, projectFolderOf } from '../project/folder.ts';
import { checkPath } from '../project/folderCheck.ts';
import { executeGraph, memoryFeedbackEdges, nodeName, runNodeAlone } from '../execution/executor.ts';
import { runExample, testGraph } from '../authoring/examples.ts';
import { registry } from '../elements/registry.ts';
import { nodeRuntime } from '../host/node.ts';
import { runtimeRequirements, type RuntimeRequirement } from '../execution/runtimeValues.ts';
import { applyValues, eventOf } from '../execution/graphInterface.ts';
import { builtPage, WEB_DIR, writeBundle } from './bundle.ts';
import { portTaken, serve } from '../host/serve.ts';
import { untilStopped } from '../host/lifecycle.ts';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { after, graphTriggers, parseInterval, triggeredNodes, type Trigger } from '../execution/triggers.ts';

export interface CliOptions {
  graphPath: string;
  /** Whether the graph was named, rather than taken to be the project in this folder, the way a bundle is laid out. */
  graphNamed: boolean;
  /** Values by the names the graph offers (`graphInterface.ts`): what it asks, and anything else it takes. */
  values: Record<string, string>;
  /** The event a round is started by, by name; none, the whole graph. */
  event?: string;
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

/** Where a served tool looks first. Nothing addresses it from outside, so this is a habit, not a contract. */
const DEFAULT_PORT = 8000;
/** How many in a row to try before a busy machine is the user's problem to sort out. */
const PORTS_TRIED = 10;

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { graphPath: '', graphNamed: false, values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--value') {
      const [name, ...rest] = (argv[++i] ?? '').split('=');
      if (name) options.values[name] = rest.join('=');
    } else if (arg === '--event') {
      options.event = argv[++i] ?? '';
    } else if (arg === '--every') {
      options.every = parseInterval(argv[++i] ?? '');
    } else if (arg === '--limit') {
      // Not a number ran nothing and said nothing: `round < NaN` is never true.
      const given = argv[++i] ?? '';
      const limit = Number(given);
      if (!given.trim() || !Number.isInteger(limit) || limit < 1) throw new Error(`--limit wants a whole number of runs, not "${given}".`);
      options.limit = limit;
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
    } else if (arg.startsWith('--')) {
      // A flag this command does not know is a mistake to say, not a file to
      // look for: taken as the graph, `--ai-provider openai g.json` went
      // looking for a graph called "--ai-provider", and after the graph it
      // was dropped without a word.
      throw new Error(
        `Unknown option "${arg}". This command knows --value, --event, --every, --limit, --bundle, `
          + '--serve, --port, --editor, --host, --mcp and --mcp-root.',
      );
    } else if (!options.graphPath) {
      options.graphPath = arg;
    }
  }
  options.graphNamed = options.graphPath !== '';
  if (!options.graphNamed) options.graphPath = '.';
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
            + `Pass --value ${requirement.key}=…`,
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

async function runOnce(graph: Graph, trigger: Trigger | null): Promise<number> {
  const runtime = nodeRuntime({
    report: (event) => {
      if (event.type === 'batch') process.stderr.write(`\r  ${event.done}/${event.total}`);
      if (event.type === 'node_done' && event.status === 'error') {
        const node = graph.nodes.find((n) => n.id === event.node_id);
        process.stderr.write(`\n  ${node ? nodeName(node) : event.node_id} failed\n`);
      }
    },
  });

  const result = await executeGraph(graph, { runtime, registry, trigger });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'error' ? 1 : 0;
}

/**
 * Run *graph* repeatedly, *interval* seconds apart.
 *
 * Measured between the end of one run and the start of the next, not between
 * starts: a graph that takes longer than its interval would otherwise pile
 * runs on top of each other until something gives.
 *
 * One graph for every round, as a served tool's clock holds one: what a round
 * leaves in a data node is what the next starts from. Read again each round,
 * a counter counted to one for ever. And a round that could not even start is
 * said, and the next one is tried: the next may be fine.
 */
async function runEvery(graph: Graph, trigger: Trigger | null, options: CliOptions): Promise<number> {
  const seconds = options.every ?? 0;
  let code = 0;
  for (let round = 0; options.limit === undefined || round < options.limit; round += 1) {
    if (round > 0) {
      process.stderr.write(`\nWaiting ${seconds}s…\n`);
      await new Promise<void>((wake) => { after(seconds * 1000, wake); });
    }
    code = await runOnce(graph, trigger).catch((error: unknown) => {
      process.stderr.write(`\nThis run failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    });
  }
  return code;
}

/** Write the graph and the engine somewhere someone else can run them. */
async function makeBundle(options: CliOptions): Promise<number> {
  const graph = await loadGraph(options.graphPath);
  // A bundle without the built page still runs on the terminal; with it, the
  // recipient gets the tool they were shown.
  const written = await writeBundle(graph, options.bundle!, { pageDir: builtPage(), frontend: frontendOf(options.graphPath) });
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
 * The page is the one a bundle carries beside its graph (`web/`), else the
 * one this checkout built -- a project run with `--serve` has none of its own
 * -- and its absence is not an error: a graph with no interface, or a bundle
 * written without a build at hand, still serves its few endpoints, which is
 * enough for anything driving it over HTTP.
 *
 * Without `--port` it takes the first free port from 8000 up. A tool someone
 * was handed is started by double-clicking it, and "the port I chose happens
 * to be taken on your machine" is not a thing its recipient should ever have
 * to know about, let alone read a Node stack trace about.
 */
async function runServer(options: CliOptions): Promise<number> {
  // No graph file is a legitimate way to run this: the editor posts the graph
  // being edited with every request, and serves one only when it is named --
  // started in a folder that happened to hold a graph.json, it shipped that
  // one and kept its clock. A bundle is the other case, and there the graph is
  // right here. A graph that was named and is not there is a mistake to say,
  // not an empty server: `serve` says it, where it reads the graph.
  const hasGraph = options.graphNamed || (!options.editor && existsSync(resolve(options.graphPath)));
  // Beside the project -- a bundle is one -- or beside a single graph file.
  const carried = resolve(projectFolderOf(options.graphPath) ?? dirname(resolve(options.graphPath)), WEB_DIR);
  const pageDir = !hasGraph ? undefined : existsSync(join(carried, 'runtime.html')) ? carried : builtPage();

  const start = (port: number) => serve({
    ...(hasGraph ? { graphPath: options.graphPath } : {}),
    pageDir,
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
  // A headless machine is a fine place to serve from; the URL is printed. A
  // missing opener is not thrown but said as an 'error' event, and unheard that
  // event ended the process -- a container's, which has no xdg-open, at start.
  spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

/**
 * Be an MCP server until the client hangs up.
 *
 * Imported here and not at the top: the server is authoring, it lives under an
 * `editor/` folder, and a bundle leaves every one of those behind. A static
 * import would make each bundle fail on a file it was never meant to have.
 */
async function runMcp(options: CliOptions): Promise<number> {
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
async function runCheck(paths: string[]): Promise<number> {
  let failed = 0;
  for (const path of paths.length ? paths : ['.']) {
    const { problems, graph } = await checkPath(path);
    if (!problems.length) {
      process.stdout.write(`✓ ${path}: ${graph!.nodes.length} nodes, ${graph!.edges.length} edges\n`);
    } else {
      failed += 1;
      process.stdout.write(`✗ ${path}: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`);
      for (const { where, problem, fix } of problems) process.stdout.write(`  ${where}: ${problem}\n    → ${fix}\n`);
    }
  }
  return failed ? 1 : 0;
}

/**
 * Run every code and ai node once on the example in its input.js and hold
 * what comes out to its output.js -- or one node, with `--node`. `--offline`
 * asks no model: an ai node is skipped, which is how CI runs it. Exit code 1
 * when one fails.
 */
async function runTests(argv: string[]): Promise<number> {
  const offline = argv.includes('--offline');
  const only = argv.includes('--node') ? argv[argv.indexOf('--node') + 1] : '';
  const paths = argv.filter((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--node');
  let failed = 0;
  for (const path of paths.length ? paths : ['.']) {
    // Every depth: the graph a node holds is part of this project (`testGraph`).
    const { tested, results } = await testGraph(await loadGraph(path), { runtime: () => nodeRuntime(), registry, offline, only });
    for (const { inside, nodeId, result } of results) {
      const mark = { pass: '✓', fail: '✗', error: '✗', skipped: '·' }[result.status];
      // A failure not held to its output.js is one whose output.js cannot be read: the line under it says why.
      const said = {
        skipped: ' (skipped)', pass: result.held ? ': fits its output.js' : ': runs',
        fail: result.held ? ': does not fit its output.js' : ': is held to no output.js', error: ': fails',
      }[result.status];
      process.stdout.write(`${mark} ${path} ${inside}${nodeId}${said}\n`);
      for (const line of result.details) process.stdout.write(`    ${line}\n`);
      if (result.status === 'fail' || result.status === 'error') failed += 1;
    }
    if (!tested) process.stdout.write(`· ${path}: ${only ? `no node "${only}"` : 'no node has an example in an input.js'}\n`);
  }
  return failed ? 1 : 0;
}

/**
 * Run one node by itself and print what it returned: on the inputs given as
 * JSON, as a run hands them to it -- files read, a list fanned out -- or,
 * without them, a code or an ai node once on the example in its input.js,
 * held to its output.js: what its ▶ Try runs, with no editor anywhere. A node
 * of another kind has no example, and runs on what the nodes feeding it
 * produce, as the MCP server's `run_node` runs it.
 */
async function runNodeCommand([path, nodeId, given]: string[]): Promise<number> {
  if (!path || !nodeId) throw new Error('Usage: run-node <graph or project> <node id> [\'{"port": value}\']');
  const graph = await loadGraph(path);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`There is no node "${nodeId}" in ${path}. Its nodes are: ${graph.nodes.map((one) => one.id).join(', ')}.`);
  if (!given && registry.node(node.node_type)?.definitions(node) === undefined) {
    process.stderr.write(`${nodeName(node)}, on what the nodes feeding it produce\n`);
    const { result } = await runNodeAlone(graph, nodeId, undefined, { runtime: nodeRuntime(), registry });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'error' ? 1 : 0;
  }
  if (!given) {
    process.stderr.write(`${nodeName(node)}, on the example in its input.js\n`);
    const tried = await runExample(graph, nodeId, { runtime: nodeRuntime(), registry });
    process.stdout.write(`${JSON.stringify(tried, null, 2)}\n`);
    return tried.status === 'pass' ? 0 : 1;
  }
  const { result } = await runNodeAlone(graph, nodeId, JSON.parse(given) as Record<string, unknown>, { runtime: nodeRuntime(), registry });
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
  const graph = await loadGraph(options.graphPath);
  // The graph's own clock, when the command line names none: a graph saved as
  // "every 5 minutes" is that on any machine, not only where someone remembers
  // the flag. `--every` still wins, which is how one run is made of it.
  if (!options.every) {
    // Its shortest interval: on the command line a round is the whole graph,
    // every trigger counted as fired, so one clock is all there is to keep.
    const intervals = graphTriggers(graph).filter((trigger) => trigger.every).map((trigger) => parseInterval(trigger.every));
    if (intervals.length) options.every = Math.min(...intervals);
  }
  // An event by name, and only what it runs is asked about; the values by name
  // too, as a page sends them -- asked once, however many rounds follow.
  const trigger = eventOf(graph, options.event, registry);
  const only = trigger ? triggeredNodes(graph, trigger, memoryFeedbackEdges(graph.nodes, graph.edges, registry)) : null;
  applyValues(graph, await answer(runtimeRequirements(graph, registry, only), options.values), registry);
  return options.every ? runEvery(graph, trigger, options) : runOnce(graph, trigger);
}
