# Deployment and the CLI

Running a saved graph from the command line, and handing one on as a tool that runs
without the editor.

## Running a graph from the command line

```bash
node engine/src/main.ts examples/population_plotter
```

Node 24 or newer, and no build step: the engine is TypeScript that Node runs directly
by stripping the types. The argument is a project folder or a single `.json` graph; with
none, it is the project in the current folder -- which is how a bundle starts
(`engine/src/cli/cli.ts` lists every form).

**A file path inside a graph is resolved against the working directory, not against the
graph file.** The examples that read data from disk therefore run from the repository
root, and they ask for their path before running, so any other location works too -- the
value in the graph is only the default. A bundle runs from its own folder, so a relative
path there resolves inside the bundle: that is why a bundle carries the files the graph
starts on (below).

Give it a value by name -- an input node by its id, a block on its page by the block's id --
and start the round one of its events starts, the way pressing that button would:

```bash
node engine/src/main.ts my_graph.json --value topic="Custom input text" --event go
```

A name the graph does not offer is turned down with the names it does; `describe_graph`
over MCP and `GET /api/runtime/interface` on a served tool list them
(`cli/cli.test.ts`: "a round by name, as a page asks for one"). The result is JSON on
stdout; questions and progress go to stderr, so `| jq` works. The exit code is 1 when the
run ended in error.

Run it on a schedule -- the whole trigger, with no service to install:

```bash
node engine/src/main.ts my_graph.json --every 30m           # until you press Ctrl+C
node engine/src/main.ts my_graph.json --every 6h --limit 4  # then stop
```

The interval is measured between the end of one run and the start of the next, so a graph
that takes longer than its interval never piles runs on top of itself. A failing run is
reported and the schedule continues. A graph whose trigger nodes name an interval runs on
the shortest one without `--every`.

Serve the graph's own page instead of running it once:

```bash
node engine/src/main.ts my_graph.json --serve --port 8123
```

Without `--port` it takes the first free port from 8000 up; a port asked for and busy is
said in a sentence. `--host` binds another address (loopback otherwise): on such a bind the
server answers only as `localhost`, or a name `AI_GRAPH_ALLOWED_HOSTS` lists, and the file
browser switches itself off (`host/serve.test.ts`). A bundle serves the page it carries, in
`web/` beside its project; a graph or project in a checkout is served the page the checkout
built (`npm run build`). `AI_GRAPH_NO_BROWSER` stops it opening a browser.

Without running anything:

```bash
node engine/src/main.ts check my_project/ other.json    # what is wrong; exit 1 if anything is
node engine/src/main.ts test my_project/ --offline      # each node on its input.js, held to its output.js
node engine/src/main.ts run-node my_project/ count      # one node, on its input.js
```

`--offline` asks no model: an AI node is skipped. CI runs `check` and `test --offline` over
every example (`.github/workflows/ci.yml`).

## Handing a graph on

**⧉ Open as a tool**, on the App tab (there while ▶ Run runs the application), opens the
graph you are editing as the delivered page, in a window of its own -- same entry point
(`runtime.html`), same routes, no editor around it. It answers "what have I actually
built" without packing a zip. It is not a deployment: nothing is written, and the window is
served by the editor you are sitting in, against the same session as the App tab.

**Deploy**, in the toolbar, downloads a zip; `node engine/src/main.ts my_graph.json --bundle ./out`
writes the same folder. It holds the graph as the project folder it was built as --
`flow.json`, its page in `page/`, a folder per node -- a verbatim copy of the engine in
`engine/`, and `run.sh` / `run.cmd`, which start it with `node engine/main.ts . --serve`
(or without `--serve` for a graph with no page). Nothing in it is generated: a bundle
runs the engine the graph was tested on, not a second implementation of it.

```bash
./run.sh          # or run.cmd on Windows
```

Without a page, the result is printed as JSON on stdout and questions and progress go to
stderr; `--every 5m` schedules it, exactly as above. With one, the bundle serves it on
localhost, on port 8000 or the next free one, and opens it.

The recipient needs Node 24 or newer and nothing else: no AI-Graph, no Python, no install
step. The launchers check for Node, say so when it is missing or too old, start from their
own folder, and use a `node/` folder beside them when there is one (the downloads in
[install.md](install.md) carry one). `run.sh` comes out of the zip executable, and a
double-clicked `run.cmd` that fails keeps its window open until the reason has been read
(`cli/launchers.test.ts`).

The editor makes the same zip over the API, which must be sent as `application/json` and
addressed to `localhost`, `127.0.0.1` or `[::1]` (or a name `AI_GRAPH_ALLOWED_HOSTS` lists
on a server bound wider):

```bash
jq '{graph: .}' my_graph.json | curl -X POST http://localhost:8000/api/deploy/bundle \
  -H "Content-Type: application/json" -d @- --output bundle.zip
```

Sent with `"path"` -- the project the graph was opened from, as Deploy sends it -- the
bundle carries that project's own page too (below).

### What a bundle carries

`engine/src/cli/bundle.ts` is the list; `cli/bundle.test.ts` holds it.

- **What runs, not how it was written.** A node's `history.md`, the ✨ prompts it changed
  and the files ✨ was given stay with the project (`withoutAuthoring`, one helper also for a
  served tool's page, the runs the editor posts and answers over MCP).
- **The page**, when the graph has one and `npm run build` has been run: only the files
  `runtime.html` references, in `web/`, with `web/licenses.txt` naming every package it is
  built from. Without a build the graph still deploys, headless, and the bundle's README
  says so.
- **The files the graph starts on**: what its file pickers and folder inputs name as
  defaults. **A tool is handed on whole, or not at all.** A relative path inside the project
  keeps its place; a file from anywhere else -- an absolute path, as 📂 Browse… picks it, or
  one through `..` -- goes to `data/`, and the graph there names it at its new place. A file
  that is not there, or more than a bundle carries (50 MB), stops Deploy before anything is
  written, and says which. A text input is a text to a bundle, even one holding a file's
  path: pick such a file on the tool's page instead.
- **`LICENSE`**, which whoever is handed the engine has to be handed with it
  ([Licences](licenses.md)), and a `README.md` saying which part comes under what: the
  graph, its page and its nodes belong to whoever built them.
- **No editor.** `engine/src/host/editor/` -- generation, settings, the MCP server -- stays
  behind, and no tests, no `state.json`. A bundle's model comes from the environment or an
  `ai-settings.json` beside `run.sh` ([ai-providers.md](ai-providers.md)).

A bundle's server also keeps the clock of the graph's trigger nodes: a trigger ticked to
fire when the tool starts, or given an interval such as `5m`, runs with nobody watching,
and the page shows the latest result.

### A page of your own

A project can bring a page written by hand: `frontend/index.html` beside its `flow.json`,
with whatever else it loads. A served project shows it at `/` in place of the built page,
and a bundle carries it. It uses the graph the way any frontend does -- through the runtime
API, by name, never by node or port; the routes and their rules are in
[connection-points.md](connection-points.md#the-runtime-api).
[`examples/nested_statistics/frontend/index.html`](../examples/nested_statistics/frontend/index.html)
is one: about a hundred lines that draw a field for every value the graph takes, a button
for every event and a box for every output, and follow the stream. What using the graph
leaves behind is kept by the server in `state.json` beside `flow.json` (see
[State](architecture.md#state)), so a page reloaded, or opened in a second tab, shows what
the first one did.

### Stopping it

Ctrl+C in its terminal, `kill`, a supervisor or `docker stop` ask the server to stop rather
than ending it where it stands: no new round starts, runs in flight are cancelled -- the
model call is aborted, the code node's process ended -- and the process exits with 0,
normally well under a second and after eight at most. A round that was cut off commits
nothing. A second Ctrl+C stops at once (`host/shutdown.test.ts`, `cli/stop.test.ts`).
`stop.cmd` / `stop.sh` stop the editor on a port; on Windows that ends the process outright,
as Windows has no SIGTERM to send to another process.

## Letting an assistant build graphs

`node engine/src/main.ts --mcp --mcp-root <folder>` is an MCP server: Claude Code, Claude
Desktop or any MCP client can generate, validate, save and run graphs inside that one
folder. See [mcp-server.md](mcp-server.md).

## Deploying the editor itself

The editor is the engine serving its built page: `npm ci && npm run build && npm start`
on the target machine, `docker compose up --build`, or the zip for Windows or Linux.
See [install.md](install.md).
