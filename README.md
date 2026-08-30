# AI-Graph

Wire nodes on a canvas into an AI workflow, then hand the result to someone else as a
tool that runs on their machine — offline, on a local model, with no account and no
cloud bill.

## Why

- **Your data never leaves the machine.** Ollama and LM Studio are the default, not a
  fallback; everything binds to `127.0.0.1`; there is no telemetry. Contracts, records
  or personnel files can be processed with no cloud account, no data-processing
  agreement and no third-country transfer, because there is no processor involved.
- **It is free to run.** A 7B model on an ordinary workstation classifies, extracts,
  summarises and rewrites. Where that is not enough, pin *one* node to a paid provider
  instead of moving the whole pipeline into the cloud.
- **No AI expertise required.** Describe in plain language what a node should do and
  ✨ Generate writes the system prompt or the Python. No prompt engineering, no vector
  store, no framework, no glue code.
- **You ship a tool, not a prototype.** 🚀 Deploy packages the graph with the real
  execution engine; one PyInstaller run makes it an executable that needs no Python on
  the target machine. A graph with `gui` nodes deploys *with its interface*.
- **Nothing is hidden.** Typed ports say what flows between nodes, generated code stays
  visible and editable, graphs are plain JSON, and a node's body can live in its own
  `.py`/`.md` file beside the graph — so `git diff` reads like text.

**The cheap option is the private one.** Running locally costs nothing *and* removes the
compliance question; the two are not a trade-off.

## What is different about it

- **Cloud is the opt-in, not the default.** In most workflow builders local execution is
  something you assemble; here it is the state you start in.
- **A deploy bundle vendors the engine, not generated code**, so a deployed graph
  behaves identically to the one in the editor — the same components, verbatim.
- **A graph can carry its own interface.** `gui` nodes build a file picker, text window
  or plot from widgets, and the node's ports are always derived from them.

## Use Cases

- **Document batch processing** — a directory of files, a Code/AI node that extracts or
  summarises each one, an Output node that writes the results back to disk.
- **Data transformation pipeline** — Input → Code node (hand-written or AI-generated
  `run(inputs)`) → Output; see [examples/bla_counter.json](examples/bla_counter.json).
- **Local-LLM chat or report tool** — an AI node on Ollama/LM Studio fed by a file input,
  paired with a `gui` node's `text_io` widget: a runnable front-end with zero UI code.
- **A graph as a standalone tool** — once it works in the editor, 🚀 Deploy hands a
  non-technical user or a CI job something that runs without the AI-Graph editor at all.

## Privacy and local processing

Nothing leaves the machine unless the graph itself sends it there.

- `start.py`, the built executable and a deployed bundle bind to `127.0.0.1` —
  reachable from the machine itself, not from the network.
- The file browser is tied to that bind: started with `--host 0.0.0.0`, a deployed tool
  switches its browse endpoint off rather than exposing the host's filesystem listing
  (`graph-runner/serve.py`).
- No analytics or phone-home calls exist in the code; the only outbound connections are
  the ones your graph is configured to make.
- API keys are write-only, and the code-generation AI belongs to your browser rather
  than to the graph — a graph you hand on carries neither a key nor a model choice of
  yours.
- A deploy bundle runs offline: the engine, `graph.json` and a local
  `~/.ai-graph/code-env`. A graph on a local model works with no internet access at all.

---

## What's in it

- **Visual graph editor** — a ReactFlow canvas with undo/redo; drop a graph `.json` on
  the window to open it, the way the files in `examples/` load.
- **Six node types** — Input (text/file/directory), AI, Code (Python/JavaScript), Data,
  GUI, Output.
- **AI generation** — a node's code or system prompt, a plot transform, or an entire
  graph, written from a plain-language description and left visible and editable. Code
  generation starts from a typed skeleton of the node's real ports — the types and
  example values come from the last run — and the result is executed once and repaired
  before you ever see it.
- **Graph DSL** — versioned JSON with typed ports (`data_type`, `multi`, `format`), so a
  node's inputs and outputs are never ambiguous.
- **Execution engine** — topological order with per-node status, batch items run
  concurrently, a failed item is reported as `partial` while the rest continue, transient
  AI failures are retried, and Stop ends the work rather than just stopping watching it.
  The toolbar counts items *within* the running node and says when a model has gone quiet,
  so a long batch is never mistaken for a hang — and a model that answers with nothing at
  all fails the node instead of quietly passing an empty string on.
- **A project is a graph plus one file per node** — code, prompts and format contracts
  live in `.py`/`.js`/`.md` files beside the graph, so a language server and `git diff`
  both work on them.
- **GUI nodes** — a file picker, text window, plot or image view, added and arranged by
  dragging them on one grid, and deployed together with the graph.
- **Deployment** — a self-contained bundle, a Docker Compose stack, or one executable.
- **Graph Runner CLI** — run any saved graph from the command line.

## The examples

`examples/` holds runnable graphs; drop any of them onto the editor window to open it.
Every one of them is executed by the test suite, so they cannot quietly rot.

| Graph | What it shows | Needs a model |
|---|---|---|
| [hello_world.json](examples/hello_world.json) | The smallest graph there is | no |
| [plotter_interactive.json](examples/plotter_interactive.json) | Pick a CSV at run time, reshape it in a code node, chart it — picker and plot in one GUI node | no |
| [text_summary.json](examples/text_summary.json) | Summarize each story in a folder, then summarize the summaries: the same AI node twice, differing only in `batch_mode` | yes |
| [bla_counter.json](examples/bla_counter.json) | A counter that remembers across runs (memory feedback) | no |
| [gui_file_to_ai_to_text.json](examples/gui_file_to_ai_to_text.json) | Pick a file, run it through AI, read the answer in a window | yes |

A path inside a graph resolves against the working directory, so run the ones that read
files from the repository root:

```bash
python graph-runner/run.py examples/plotter_interactive.json
```

## Quick start

```bash
git clone https://github.com/Archimedes79/AI_Graph.git
cd AI_Graph
docker compose up --build
```

The editor is then at <http://localhost:3000>. Without Docker, `python start.py` starts
both servers, and `python build_editor_exe.py` builds an executable you can double-click.
All four ways, with their trade-offs, are in [docs/install.md](docs/install.md).

## Documentation

| Document | What is in it |
|---|---|
| [docs/install.md](docs/install.md) | Docker, dev mode, `start.py`, the standalone executable, tests and CI |
| [docs/graphs.md](docs/graphs.md) | The Graph DSL, code and AI nodes, GUI nodes and widgets |
| [docs/ai-providers.md](docs/ai-providers.md) | Providers, the two AI settings, where the API key goes |
| [docs/deployment.md](docs/deployment.md) | Deploy bundles, Docker, the Graph Runner CLI |
| [AGENTS.md](AGENTS.md) | Codebase map for contributors: which file to touch for a given change |

## Project structure

```
AI-Graph/
├── backend/          # FastAPI backend (app/models, app/routers, app/elements, app/services)
├── frontend/         # React + TypeScript + ReactFlow editor (src/elements, src/components, src/store)
├── graph-runner/     # run.py (CLI) / serve.py (GUI runtime) / build_exe.py — vendored into every deploy bundle
├── docs/             # The documents linked above
├── examples/         # Example graph JSON files
├── checkpoint.py     # Verify + package the editor in one command
└── docker-compose.yml
```

---

## Licence

AI-Graph is **source-available, not open source**: [PolyForm Noncommercial
1.0.0](LICENSE).

- Any **noncommercial** use is permitted — personal, research, teaching, and
  noncommercial organisations. Use it, change it, share it.
- **Commercial use needs a separate licence** from the copyright holder. Open an
  issue to ask for one.

**What you build with AI-Graph is yours.** Your graph, and the code generated
into it, belong to you. A deploy bundle contains nothing but that plus the
runtime engine, and the engine ships under its own
[`LICENSE-runtime`](LICENSE-runtime) — which is why every bundle carries a copy
of the terms: whoever receives the software has to receive them with it. No part
of the editor (the canvas, the generator, the deploy tool itself) ever travels
in a bundle; `backend/tests/test_deploy_boundary.py` fails if one starts to.

The two licence files hold the same text today. They are separate because the
intention is for a *deployed tool's* terms to become permissive and stay that
way, unbounded in time, independently of the editor's — and `LICENSE-runtime`
is the one file that changes when that is settled.

Licensing is not final. If you want to use AI-Graph commercially, open an
issue — that conversation is welcome.
