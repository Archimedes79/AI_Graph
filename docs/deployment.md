# Deployment and the CLI

Running a saved graph from the command line, and packaging one as a tool that runs
without the editor.

## Running a graph from the command line

```bash
node engine/src/main.ts examples/hello_world.json
node engine/src/main.ts examples/bla_counter.json
```

Node 24 or newer, and no build step: the engine is TypeScript that Node runs directly
by stripping the types.

**A file path inside a graph is resolved against the working directory, not against the
graph file.** The examples that read data from disk therefore run from the repository
root:

```bash
node engine/src/main.ts examples/universal_plotter.json
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
editor has a built frontend (`cd frontend && npm run build`), the bundle also carries the
page and serves it: the file pickers, text windows and plots the graph was designed with,
rendered by the very same components the editor used, copied rather than rebuilt. It
listens on localhost only. Without a built frontend the graph still deploys, just
headless, and the bundle's README says so.

The recipient needs Node, and nothing else — no AI-Graph, no Python, no install step.

Or use the API:

```bash
curl -X POST http://localhost:8000/api/deploy/bundle \
  -H "Content-Type: application/json" \
  -d @my_graph.json \
  --output bundle.zip
```

See [engine/src/bundle.ts](../engine/src/bundle.ts) for exactly which files a bundle
contains and why it can never drift from the editor.

## Deploying the editor itself

See [Option 3 – `start.py` launcher](install.md#option-3--startpy-launcher): `python start.py --mode package` builds a zip of the editor app (server + built frontend) to run on another server.
