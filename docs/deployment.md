# Deployment and the CLI

Running a saved graph from the command line, and packaging one as a tool that runs
without the editor.

## Running a graph from the command line

```bash
node engine/src/main.ts examples/population_plotter
```

Node 24 or newer, and no build step: the engine is TypeScript that Node runs directly
by stripping the types.

**A file path inside a graph is resolved against the working directory, not against the
graph file.** The examples that read data from disk therefore run from the repository
root:

```bash
node engine/src/main.ts examples/folder_summaries
```

They ask for their path before running, so any other location works too — the value in
the graph is only the default.

The same rule holds after deployment: a bundle runs from its own directory, so a relative
data path in the graph resolves inside the bundle. That is why **a bundle carries the files
the graph starts on** (see [What a bundle carries](#what-a-bundle-carries)) -- every one of
them, or there is no bundle: a tool is handed on whole.

Give it a value by name -- an input node by its id, a block on its page by the block's id --
and start the round one of its events starts, the way pressing that button would:

```bash
node engine/src/main.ts my_graph.json --value topic="Custom input text" --event go
```

A name the graph does not offer is turned down with the names it does; `describe_graph` over
MCP and `GET /api/runtime/interface` on a served tool list them.

Run it on a schedule — the whole trigger, with no service to install:

```bash
node engine/src/main.ts my_graph.json --every 30m           # until you press Ctrl+C
node engine/src/main.ts my_graph.json --every 6h --limit 4  # then stop
```

The interval is measured between the end of one run and the start of the next, so a graph
that takes longer than its interval never piles runs on top of itself. A failing run is
reported and the schedule continues.

Serve the graph's own page instead of running it once:

```bash
node engine/src/main.ts my_graph.json --serve --port 8123
```

A bundle serves the page it carries, in `web/` beside its project; a graph or a
project in a checkout is served the page the checkout built (`npm run build`).

---

There are two, independent kinds of "deploy" in AI-Graph.

## Deploying a graph

Before any of it: **⧉ Open as a tool**, on the App tab (there while ▶ Run runs the
application), opens the graph you are
editing as the delivered page, in a window of its own — same entry point (`runtime.html`),
same routes, no editor around it. It answers "what have I actually built" without packing
a zip first. It is not a deployment: no bundle is written, and the window is served by the
editor you are sitting in, against the same session as the App tab -- the same values, the
same rounds, the same clock, which the server keeps as a bundle's server would. A round
started there lights up the graph canvas too.

From the toolbar, **🚀 Deploy** gives you a zip holding the vendored
engine, your graph as the project folder it was built as -- `flow.json`, its page in
`page/`, a folder per node -- and a `run.sh` / `run.cmd` that starts it. Nothing in
it is generated: the engine is a verbatim copy of the one the graph was built and tested
on, so a bundle runs what was tested rather than a second implementation of it. The graph
carries what runs, and not how each node was written: its history.md, the ✨ prompts it
changed and the files ✨ was given stay with the project -- a history holds every prompt and
reply, and the start of those files -- and a served tool's page is not handed them either,
nor is a run the editor posts, an answer over MCP, or the model asked to change the graph
(`withoutAuthoring`, one helper for all of them).

```bash
./run.sh          # or run.cmd on Windows
```

Without a page, the result is printed as JSON on stdout and questions and progress
go to stderr, so `./run.sh | jq` works. `--every 5m` schedules it, exactly as above.

**A graph with a page deploys with its page.** If the graph has one and the editor is
built (`cd editor && npm run build`), the bundle also carries the page and serves it: the
file pickers, text blocks and charts the graph was built with, under the graph's name and
description, rendered by the very same components the editor used, copied rather than
rebuilt. It listens on localhost only, on port 8000 or the next free one — a tool someone
was handed must not die because that machine already has something on 8000, which is
what it used to do, with an unhandled `EADDRINUSE` where the window should have been. The
address it settled on is printed and opened. Without a built editor the graph still deploys, just
headless, and the bundle's README says so.

The recipient needs Node, and nothing else — no AI-Graph, no Python, no install step.

Or use the API:

```bash
jq '{graph: .}' my_graph.json | curl -X POST http://localhost:8000/api/deploy/bundle \
  -H "Content-Type: application/json" \
  -d @- \
  --output bundle.zip
```

Sent with `"path"` -- the project the graph was opened from, as the editor's Deploy sends
it -- the bundle carries that project's own page too (below).

See [engine/src/cli/bundle.ts](../engine/src/cli/bundle.ts) for exactly which files a bundle
contains and why it can never drift from the editor.

A call like this one must say `Content-Type: application/json`, and it must be addressed
to `localhost`, `127.0.0.1` or `[::1]` — with the server's own port on a server bound to
this machine — or, on one bound wider, by a name `AI_GRAPH_ALLOWED_HOSTS` lists: the
server answers its own page and scripts on this machine, not a web page elsewhere in the
browser that found the port.

### What a bundle carries

The graph, a verbatim copy of the engine, the page when the graph has one (built, in
`web/`: a project's `page/` is the page itself, its blocks) — and **the
files the graph starts on**: what its file pickers and folder inputs name as defaults, so a
tool handed to someone opens on its example data rather than on "no such file". **A tool is
handed on whole, or not at all.** A relative path inside the project keeps its place, and
nothing in the graph changes; a file from anywhere else -- an absolute path, as 📂 Browse…
picks it, or one through `..` -- goes to `data/` in the bundle, and the graph there names
it at its new place. A file that is not there, or more than a bundle carries (50 MB), stops
Deploy before anything is written, and it says which: choose one that is there and
smaller, or clear the field. A text input is a text to a bundle, even one holding a file's
path for the node that reads it: pick such a file on the tool's page instead.
The launchers `cd` into the bundle first, so those relative paths mean the same there.
They are the same pair the downloadable editor ships (`engine/src/cli/launchers.ts`): they
check for Node 24 before starting and say so when it is missing or too old, `run.sh` comes
out of the zip executable, and a double-clicked `run.cmd` that fails keeps its window open
until the reason has been read.

And the terms: `LICENSE`, which whoever is handed the engine has to be handed with it, and
`web/licenses.txt` beside the page -- every package the page is built from, with its
licence ([Licences](licenses.md)). The bundle's README says which part comes under what:
the graph, its page and its nodes belong to whoever built them.

A bundle's server also keeps the clock of the graph's trigger nodes: a trigger ticked to
fire when the tool starts, or given an interval such as `5m`, runs with nobody watching,
and the page shows the latest result.

### A page of your own

A project can bring a page written by hand: `frontend/index.html` beside its `flow.json`,
with whatever else it loads. A served project shows it at `/` in place of the built page,
and a bundle carries it. It uses the graph the way any frontend does -- through the runtime
API, by name, never by node or port:

| Route | What it is for |
|---|---|
| `GET /api/runtime/interface` | What the graph offers: its events, the values it takes and the outputs it hands back, by name -- a block on its page by the block's id, an input, output or trigger node by its own -- and the session's id |
| `GET /api/runtime/stream` | Server-sent events: `session` (values, outputs, rounds) on connect and after every change, `round` as each round starts, goes and ends -- this page's, the clock's, another tab's |
| `POST /api/runtime/rounds` | `{ event, values }`: start a round; watch it on the stream, or at `GET /api/runtime/rounds/:id` |
| `POST /api/runtime/run` | The same, answered once the round has ended: `{ status, outputs, values }` -- a function call |
| `GET /api/runtime/session` | What the stream says on connect, for a page that does not listen |
| `POST /api/runtime/reset` | Forget what using the graph left behind: it is as designed again |

[`examples/nested_statistics/frontend/index.html`](../examples/nested_statistics/frontend/index.html)
is one: a hundred lines that draw a field for every value the graph takes, a button for
every event -- or one Run for a graph that has none -- and a box for every output, and
follow the stream. What using the graph leaves behind is kept by the server, in
`state.json` beside `flow.json` (see [State](architecture.md#state)), so a page reloaded,
or opened in a second tab, shows what the first one did.

**Stopping it.** Ctrl+C in its terminal, `kill`, a supervisor or `docker stop` all ask the
server to stop rather than ending it where it stands: no new round starts, runs in flight
are cancelled — the model call is aborted, the code node's process ended — and the process
exits with 0, normally well under a second and after eight at most. A round that was cut
off commits nothing; the page shows what the last one that finished left. A second Ctrl+C stops at
once. (`stop.cmd` on Windows still ends the process outright: Windows has no SIGTERM to
send to another process.)

## Letting an assistant build graphs

`node engine/src/main.ts --mcp --mcp-root <folder>` is an MCP server: Claude Code, Claude
Desktop or any MCP client can generate, validate, save and run graphs inside that one
folder. See [mcp-server.md](mcp-server.md).

## Deploying the editor itself

The editor is the engine serving its built page: `npm ci && npm run build && npm start`
on the target machine, or `docker compose up --build`. See [install.md](install.md).
