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

The same rule bites once more after deployment: **a bundle ships the tool, not the
data.** It reads its `graph.json` from its own directory, so a relative data path in the
graph resolves inside the bundle, where the file is not. Either pick the file in the
tool's own interface (what a graph with a picker or a `prompt_at_runtime` input is for),
or store an absolute path before deploying.

Override an input node:

```bash
node engine/src/main.ts my_graph.json --inputs my-text-node-id="Custom input text"
```

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

---

There are two, independent kinds of "deploy" in AI-Graph.

## Deploying a graph

Before any of it: **🚀 Deploy → Open as a tool** opens the graph you are editing as the
delivered page, in a window of its own — same entry point (`runtime.html`), same routes,
no editor around it. It answers "what have I actually built" without packing a zip
first. It is not a deployment: nothing is written, and the window is served by the editor
you are sitting in. (▶ Run opens the same page in the Preview tab, attached to the
document, so a run there still lights up the graph canvas.)

From the toolbar, **🚀 Deploy → Download Bundle** gives you a zip holding the vendored
engine, your graph as `graph.json`, and a `run.sh` / `run.cmd` that starts it. Nothing in
it is generated: the engine is a verbatim copy of the one the graph was built and tested
on, so a bundle runs what was tested rather than a second implementation of it.

```bash
./run.sh          # or run.cmd on Windows
```

Without an interface, the result is printed as JSON on stdout and questions and progress
go to stderr, so `./run.sh | jq` works. `--every 5m` schedules it, exactly as above.

**Graphs with a GUI deploy with their GUI.** If the graph contains `gui` nodes and the
editor has a built editor (`cd editor && npm run build`), the bundle also carries the
page and serves it: the file pickers, text windows and plots the graph was designed with,
rendered by the very same components the editor used, copied rather than rebuilt. It
listens on localhost only, on port 8000 or the next free one — a tool someone was handed
must not die because that machine already has something on 8000, which is what it used
to do, with an unhandled `EADDRINUSE` where the window should have been. The address it
settled on is printed and opened. Without a built editor the graph still deploys, just
headless, and the bundle's README says so.

The recipient needs Node, and nothing else — no AI-Graph, no Python, no install step.

Or use the API:

```bash
curl -X POST http://localhost:8000/api/deploy/bundle \
  -H "Content-Type: application/json" \
  -d @my_graph.json \
  --output bundle.zip
```

See [engine/src/cli/bundle.ts](../engine/src/cli/bundle.ts) for exactly which files a bundle
contains and why it can never drift from the editor.

### What a bundle carries

The graph, a verbatim copy of the engine, the page when the graph has one — and **the
files the graph starts on**: what its file pickers and input nodes name as defaults, copied
to the same relative place, so a tool handed to someone opens on its example data rather
than on "no such file". Only relative paths inside the project are carried; an absolute
path, or anything over 50 MB, is listed in the bundle's README as the recipient's to bring.
The launchers `cd` into the bundle first, so those relative paths mean the same there.

A bundle's server also keeps the graph's own clock (*⚙ Settings → What starts this graph*):
`on start` and `every 5m` run with nobody watching, and the page shows the latest result.

**Stopping it.** Ctrl+C in its terminal, `kill`, a supervisor or `docker stop` all ask the
server to stop rather than ending it where it stands: no new round starts, runs in flight
are cancelled — the model call is aborted, the code node's process ended — and the process
exits with 0, normally well under a second and after eight at most. A round that was cut
off is not remembered; the page shows the last one that finished. A second Ctrl+C stops at
once. (`stop.cmd` on Windows still ends the process outright: Windows has no SIGTERM to
send to another process.)

## Letting an assistant build graphs

`node engine/src/main.ts --mcp --mcp-root <folder>` is an MCP server: Claude Code, Claude
Desktop or any MCP client can generate, validate, save and run graphs inside that one
folder. See [mcp-server.md](mcp-server.md).

## Deploying the editor itself

The editor is the engine serving its built page: `npm ci && npm run build && npm start`
on the target machine, or `docker compose up --build`. See [install.md](install.md).
