# Deployment and the CLI

Running a saved graph from the command line, and packaging one as a tool that runs
without the editor.

## Graph Runner CLI

Run any graph JSON from the command line:

```bash
cd graph-runner
python run.py ../examples/hello_world.json
python run.py ../examples/bla_counter.json
```

**A file path inside a graph is resolved against the working directory, not against
the graph file.** The two examples that read data from disk therefore run from the
repository root, not from `graph-runner/`:

```bash
python graph-runner/run.py examples/plotter_interactive.json
python graph-runner/run.py examples/text_summary.json
```

Both prompt for their path before running, so any other location works too — the
value in the graph is only the default.

The same rule bites once more after deployment: **a bundle ships the tool, not the
data.** `main.py` reads its `graph.json` from its own directory, so a relative data
path in the graph resolves inside the bundle, where the file is not. Either pick the
file in the bundle's own interface (what a graph with a picker or a
`prompt_at_runtime` input is for), or store an absolute path before deploying.

Override text input nodes:
```bash
python run.py my_graph.json --inputs my-text-node-id="Custom input text"
```

Run it on a schedule — the whole trigger, with no service to install:
```bash
python run.py my_graph.json --every 30m          # until you press Ctrl+C
python run.py my_graph.json --every 6h --times 4 # then stop
```

The interval is measured between the end of one run and the start of the next, so a graph
that takes longer than its interval never piles runs on top of itself. A failing run is
reported and the schedule continues.

---

There are two, independent kinds of "deploy" in AI-Graph.

## Deploying a graph

From the frontend toolbar, click **🚀 Deploy** to:

- **Download Bundle** – get a zip containing the vendored engine, your graph as
  `graph.json`, a `main.py`, `requirements.txt`, `Dockerfile`, `docker-compose.yml`,
  and a `README.md` with run instructions — no AI-Graph backend needed at runtime
- **View Docker Compose** – preview the generated compose file

A bundle can then be run three ways:

```bash
python main.py                 # command line
python serve.py                # browser interface (GUI graphs, see below)
python build_exe.py            # -> dist/<name>, a single executable
```

If the graph has Python code nodes, build the executable with
`python build_exe.py --embed-python`: it ships an interpreter inside the binary, so
those nodes run on a machine with no Python installed — which is the whole point of
handing someone an executable. Nodes that declare packages still need a real Python
on the target, because the embeddable interpreter has no `pip`; see
[install.md](install.md#code-nodes-and-the-target-machine) for the full split.

**Graphs with a GUI deploy with their GUI.** If the graph contains `gui`/`widget`
nodes and the editor has a built frontend (`cd frontend && npm run build`), the
bundle also gets `serve.py` and a `static/` folder. `python serve.py` opens the
tool's own page: the file pickers, text windows and plots the graph was designed
with, rendered by the very same components the editor used. A gear icon in that page
points the tool at a different AI and remembers the choice. Without a built
frontend the graph still deploys, just headless, and the bundle's README says so.

Or use the API:

```bash
curl -X POST http://localhost:8000/api/deploy/bundle \
  -H "Content-Type: application/json" \
  -d @my_graph.json \
  --output bundle.zip
```

See [engine/src/bundle.ts](../engine/src/bundle.ts) for exactly which files a bundle
contains and why it can never drift from the editor: the engine is copied verbatim
rather than generated.

## Deploying the editor itself

See [Option 3 – `start.py` launcher](install.md#option-3--startpy-launcher): `python start.py --mode package` builds a zip of the editor app (backend + built frontend) to run on another server.
