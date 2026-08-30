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
python graph-runner/run.py examples/plotter.json
python graph-runner/run.py examples/text_summary.json
```

Both prompt for their path before running, so any other location works too — the
value in the graph is only the default.

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

See [AGENTS.md](../AGENTS.md#deploying-a-graph--vendored-runtime-bundles-not-codegen) for
exactly which files a bundle contains and why it can never drift from the editor.

## Deploying the editor itself

See [Option 3 – `start.py` launcher](install.md#option-3--startpy-launcher): `python start.py --mode package` builds a zip of the editor app (backend + built frontend) to run on another server.
