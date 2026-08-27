# AI-Graph

**AI-Graph** is a no-code, node-based AI workflow orchestration platform: connect nodes
on a visual canvas to build data/AI pipelines, describe a graph as a portable JSON DSL,
generate or edit it with AI, run it locally, or deploy it as a standalone service
— without hand-writing glue code.

Nodes are connected through typed, explicit ports (data type, single-value-vs-batch,
optional format) rather than opaque code, so what flows between them is always visible
in the graph itself, not hidden inside a block's implementation.

## Goals

- **No-code by default, code when you need it** — every AI/Code node's behavior starts
  as a plain-text description; the AI can turn that into a system prompt or working
  Python/JavaScript, and the generated code stays visible and editable, never hidden.
- **Portable, explicit contracts** — graphs are a versioned JSON DSL with typed ports
  (`data_type`, `multi`, `format`) so a node's inputs/outputs are never ambiguous.
- **Run anywhere the graph was built** — the same graph runs in the editor, from the
  `graph-runner` CLI, or from a deploy bundle that vendors the real engine verbatim;
  behavior must stay identical across all three.
- **Composable interfaces, not just pipelines** — `gui` nodes let a graph define its own
  runtime interface (file pickers, text/chat windows, plots) from small, independent
  widgets instead of a hard-coded form.

## Use Cases

- **Document batch processing** — a Directory Input lists files (optionally filtered by
  extension and an AI-generated selector), a Code/AI node extracts or summarizes each
  file's content, and an Output node writes the results back to disk. The `Read File`
  presets exist specifically for this: paths are auto-resolved to content before the
  node runs.
- **Data transformation pipeline** — Text/File Input → Code node (hand-written or
  AI-generated `run(inputs)`) → Output; see `examples/text_transform.json`. Fan-in
  (multiple edges into one multi input port) and fan-out (one output wired to many
  inputs) need no dedicated node -- any join/split logic (concat/sum/count/
  aggregate, or splitting text into a list) is just a few lines in a `code` node.
- **Local-LLM chat or report tool** — an AI node backed by Ollama/LM Studio (no cloud
  dependency) fed by a file/directory Input, paired with a `gui` node's
  `text_io` widget for a runnable front-end with zero UI code.
- **Ad-hoc data dashboards** — a `gui` node's `plot_window` widget charts an upstream
  node's output directly, with an optional AI-generated transform snippet reshaping raw
  data into plot-ready points.
- **Deploying a graph as a standalone tool** — once a graph works in the editor,
  **🚀 Deploy** packages a self-contained bundle (the real execution engine plus your
  `graph.json`, not generated code) that a non-technical user or CI job can run without
  the AI-Graph editor at all.

This file covers what AI-Graph is and how to run/use it. For where to make a given code
change (which file to touch per node type/widget kind, and the design rules behind the
codebase), see [AGENTS.md](AGENTS.md).

---

## ✨ Features

- **Visual Graph Editor** – drag-and-drop node canvas powered by ReactFlow
- **Node Types**:
  - **Input** – one node type with a `text` / `file` / `directory` mode; in directory mode it only lists rooted file paths, it does not read content (legacy `text_input` / `file_input` / `directory_input` graphs are migrated to it on load)
  - **AI Node** – send prompts to Ollama (local LLM), LM Studio, OpenAI, an OpenAI-compatible endpoint, or Anthropic
  - **Code Node** – execute generated or hand-written Python/JavaScript
  - **Data Node** – persist a `text` or `structure` (JSON) value; the free-text format prompt (AI-assisted, proposes candidate formats against an example file then picks one) carries the actual schema detail
  - **Output** – capture results, in a window (`write_mode="window"`) or written to disk (legacy `text_output` graphs are migrated on load)
- **Read-file inputs** – a `read_file_inputs` toggle on Code and AI nodes auto-resolves `file_path` inputs to actual content before running
- **AI Code Generation** – describe what a node should do; the AI writes the code
- **AI Prompt Generation** – describe the AI's role; get a system prompt generated
- **Fan-in / Fan-out** – connect one output to many inputs, or join many into one input port; this is pure edge/port wiring, not a dedicated node -- any actual aggregation (concat/sum/count/etc.) is written as a `code` node
- **Graph DSL** – graphs are JSON files; readable and writable by humans and AI alike
- **Execution Engine** – topological execution with full per-node status reporting
- **Deployment Tooling** – export a deploy bundle (vendored engine + graph.json) or a Docker Compose stack
- **Single-file executable** – every bundle ships a `build_exe.py`; one PyInstaller run turns it into an executable that needs no Python on the target machine
- **Deployed GUI** – a graph with `gui` nodes deploys *with its interface*: the bundle serves the same widgets in a browser page instead of falling back to console prompts
- **One AI setting, not one per node** – the code-generation AI is configured once for the editor; the runtime AI once for the graph, and re-pointable when it runs
- **Graph Runner CLI** – execute any saved graph from the command line

---

## 🚀 Quick Start

### Option 1 – Docker Compose (recommended)

```bash
git clone https://github.com/Archimedes79/AI-Graph.git
cd AI-Graph
docker compose up --build
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:8000](http://localhost:8000)
- API docs: [http://localhost:8000/docs](http://localhost:8000/docs)
- Ollama: [http://localhost:11434](http://localhost:11434)

Pull an Ollama model (once):
```bash
docker exec -it ai-graph-ollama-1 ollama pull llama3
```

### Option 2 – Development mode

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# opens at http://localhost:3000
```

### Option 3 – `start.py` launcher

A single Python script that starts both servers for you, no Docker required. It takes
no required arguments, so in VS Code you can just open `start.py` and press the ▷ Run
button (or `F5`) instead of typing a command:

```bash
python start.py               # dev mode: uvicorn --reload + vite dev server
python start.py --mode prod   # prod mode: one process serving API + built UI on :8000
```

`--mode prod` expects a built frontend (`cd frontend && npm run build` first); it then runs a single `uvicorn` process that serves both the API and the built UI from `frontend/dist`, making it the simplest way to deploy the editor itself to another server.

To hand the editor to another server without cloning the repo or installing Node there, build a self-contained zip instead:

```bash
python start.py --mode package                    # builds the frontend, then zips everything needed
python start.py --mode package --skip-build       # reuse an already-built frontend/dist
python start.py --mode package --output my.zip    # custom output path
```

The zip contains `backend/app`, `backend/requirements.txt`, the built `frontend/dist`, `start.py` and `README.md`. On the target machine: unzip, `pip install -r backend/requirements.txt` (ideally in a venv), then `python start.py --mode prod`.

`python checkpoint.py` runs this whole pipeline in the safe order for you before a
release: checks generated types are current, runs both test suites, builds the
frontend, and packages the zip above — stopping at the first failure. Use
`--skip-tests` to just build+package, or `--verify-only` to check without packaging.

### Option 4 – standalone executable

The zip above still expects Python and `pip install` on the target machine. To hand
someone a file they just run, build the editor into one executable:

```bash
pip install pyinstaller          # build machine only
python build_editor_exe.py       # -> dist/ai-graph[.exe]
```

Run it (or double-click it) and it serves the editor on
[http://127.0.0.1:8000](http://127.0.0.1:8000), opening a browser by itself. The
backend, the built UI, and the sources the Deploy feature vendors are all embedded —
no Python, Node or pip needed on the target. `--onedir` emits a folder instead of a
single file (starts faster), `--skip-build` reuses an existing `frontend/dist`, and
`AI_GRAPH_PORT` picks a different port. `python checkpoint.py --exe` runs the full
verify-and-package pipeline and builds the executable at the end.

Cross-compiling is not supported: build the Windows `.exe` on Windows, the Linux
binary on Linux, the macOS binary on macOS.

Two things still come from the target machine, because they are separate interpreters
that cannot be embedded: **Python code nodes need a `python` on PATH** (a real one —
the Microsoft Store stub is detected and rejected with a clear message) and
**JavaScript code nodes need `node`**. Everything else — AI calls, file I/O, GUI
widgets, deploy-bundle export — works standalone.

---

## 📖 Graph DSL

Graphs are stored as JSON and can be created, modified, or generated by an AI:

```json
{
  "metadata": { "name": "My Graph", "version": "1.0.0" },
  "nodes": [
    {
      "id": "n1",
      "node_type": "input",
      "label": "Greeting",
      "config": { "value": "Hello, World!" },
      "outputs": [{ "id": "output", "name": "Output", "kind": "output", "data_type": "text", "multi": false, "required": false, "description": "" }]
    },
    {
      "id": "n2",
      "node_type": "output",
      "label": "Result",
      "config": { "output_label": "Final" },
      "inputs": [{ "id": "value", "name": "Value", "kind": "input", "data_type": "any", "multi": true, "required": false, "description": "" }]
    }
  ],
  "edges": [
    { "id": "e1", "source_node_id": "n1", "source_port_id": "output", "target_node_id": "n2", "target_port_id": "value" }
  ]
}
```

---

## ⚙️ Code Nodes

Code nodes run a `run(inputs: dict) -> dict` function. Python and JavaScript are supported.

```python
def run(inputs):
    text = inputs.get("text", "")
    return {"word_count": len(text.split()), "upper": text.upper()}
```

The AI can generate this function for you: just describe what the node should do.

---

## 🧩 GUI Nodes

A `gui` node is a composable interface node: it holds an ordered list of **widgets**
(`config.gui_widgets`), and its ports are *always* derived from that list — you never
hand-edit a GUI node's inputs/outputs. Add, remove, or reorder widgets and the node's
ports are regenerated to match. This is the core interface contract: **a GUI node's
inputs and outputs always reflect exactly what its widgets are capable of.**

| Widget kind | Ports it contributes |
|---|---|
| `input_picker` (mode `file`) | 1 output (file path) |
| `input_picker` (mode `directory`) | 1 output (list of file paths, filtered by `extensions`) |
| `text_io` | 1 input + 1 output (text passthrough; precedence depends on its `mode`) |
| `plot_window` | 1 input only — display-only, no downstream port, like an `output` node with `write_mode="window"` |

Each widget's ports are named `f"{widget.id}_in"` / `f"{widget.id}_out"`, so a widget's
`id` must stay stable once assigned — that's the only thing keeping existing edges
attached across GUI edits.

### Picking files and folders

Every path field — the picker widget, the *Before running…* prompt, and a node's default
path — has a **Browse…** button that opens a file chooser. It browses the machine the
graph runs on, not the one the browser is on, because that is where the engine opens
files; a native browser file dialog cannot be used here, since browsers reveal only a
file's name and never its location. Deployed tools get the same picker, but only when
bound to localhost (the default): started with `--host 0.0.0.0` the browse endpoint is
switched off rather than exposing the host's filesystem listing to the network.

### The GUI window and designer

At runtime, every `gui` node opens its own floating **GUI window** showing *all* of its
widgets together — a file picker, a text window, a plot, etc. in one interface — with
each widget fed its live value from the run. Values chosen at runtime are written back
into the graph, so a selected file survives the run and a save/reload.

Layout is edited in the **Designer** tab of the GUI node editor: widgets are placed on a
12-column grid via `x`/`y`/`w`/`h` on each widget. These are presentational only — they
never affect ports, wiring, or execution — and widgets without coordinates simply stack
in list order.

### Cyclic graphs: gui → ai → gui

A `gui` node usually has both outputs (e.g. `input_picker`) and inputs (e.g. `text_io`),
so the natural "pick a file → process it with AI → show the answer in the text window"
pattern wires `gui → ai → gui` — a cycle at node level. `data`, `gui`, and `widget`
nodes are **memory elements**: their output can reflect its own persisted value instead
of being freshly recomputed each round, so a cycle-closing edge into one of them is
automatically excluded from execution ordering — no manual "deferred" marking needed —
and settles into the node's stored value once the round finishes, ready for the *next*
run. See [examples/gui_file_to_ai_to_text.json](examples/gui_file_to_ai_to_text.json)
for a working File Open → AI → Text Window graph, and
[AGENTS.md](AGENTS.md#memory-feedback-edges-dataguiwidget-nodes) for the underlying
algorithm.

### Plot window data transforms

`plot_window` needs a data-transform snippet with the **same contract as a Code node**:
`run(inputs: dict) -> dict`, receiving `{"value": <raw incoming data>}` and returning
`{"value": <plot-ready data>}` — a list of numbers, or a list of `{x, y}` /
`{label, value}` objects. The AI can generate this transform for you, the same way it
generates Code node bodies.

### Generating whole graphs with AI

`POST /api/ai/generate-graph` asks the AI to author a complete Graph DSL document
(nodes, ports, edges) from a natural-language description, returned already validated
against the Graph schema. Use it from the "✨ AI Graph" toolbar action, or standalone
(e.g. from a script or CI) without touching the editor at all.

---

## 🤖 AI Providers

| Provider | Model | Env var needed |
|---|---|---|
| **Ollama** (default) | llama3, mistral, … | `OLLAMA_BASE_URL` (default: localhost) |
| LM Studio | any locally loaded model | `LMSTUDIO_BASE_URL` (default: `http://localhost:1234/v1`) |
| OpenAI | gpt-4o, gpt-4-turbo, … | `OPENAI_API_KEY` |
| Anthropic | claude-3-5-sonnet, … | `ANTHROPIC_API_KEY` |
| OpenAI-compatible endpoint | Any compatible model | `OPENAI_COMPATIBLE_BASE_URL`, optional `OPENAI_COMPATIBLE_API_KEY` |

Set environment variables in a `.env` file or pass them to Docker Compose.

### Choosing the AI once, not per node

Two separate settings, both behind **⚙ Settings** in the toolbar:

- **Code generation AI** – used by every ✨ Generate action. It belongs to your
  browser, not to the graph, so a graph you share carries no model choice of yours.
- **Runtime AI default** – what the graph's AI nodes call. Saved with the graph as
  `metadata.ai_defaults`; every AI node left on *"Use the graph's default"* follows
  it, so a graph with eight AI nodes is configured once.

### Where the API key goes

**⚙ Settings only picks a provider and model — it has no key field.** A hosted provider
reads its credential from the environment, or from an `ai-settings.json`:

```json
{
  "codegen":  { "provider": "anthropic", "model": "claude-sonnet-4-5" },
  "ai":       { "provider": "lmstudio",  "model": "qwen2.5-coder-7b" },
  "api_keys": { "anthropic": "sk-ant-…", "openai": "", "github": "", "openai_compatible": "" },
  "endpoints": { "lmstudio_base_url": "http://localhost:1234/v1" }
}
```

`codegen` is the AI that answers ✨ Generate, `ai` the one the graph calls when it runs —
so you can generate with a strong hosted model and execute against a local one. The file
is looked up in the working directory, next to the executable, at `$AI_GRAPH_SETTINGS`,
and finally `~/.ai-graph/settings.json`. Restart the backend after editing it.

Two provider names are worth spelling out:

- **Anthropic** needs an API key from [console.anthropic.com](https://console.anthropic.com)
  (`ANTHROPIC_API_KEY`, or `api_keys.anthropic`). A locally installed Claude Desktop or
  Claude Code is *not* an endpoint this can call — those are applications, not an API
  server on your machine, so there is nothing to point a base URL at.
- **GitHub Copilot** in the provider list means the [GitHub Models](https://models.github.ai)
  API, which is OpenAI-compatible. It authenticates with a GitHub personal access token
  (`GITHUB_TOKEN`, or `api_keys.github`) that has the `models:read` scope — not with a
  Copilot editor subscription, which exposes no API of its own.

Anything else that speaks the OpenAI protocol — a proxy, a gateway, a self-hosted
server — goes in as **OpenAI-compatible endpoint** with its own base URL and key.

A deployed graph can be re-pointed at a different runtime AI without editing it, highest
precedence first: `--ai-provider`/`--ai-model` (CLI or the deployed GUI's settings
panel) → `AI_GRAPH_AI_PROVIDER`/`AI_GRAPH_AI_MODEL` → an `ai-settings.json` next to the
executable (also holds endpoints/API keys, so a double-clicked tool needs no
environment variables at all) → the graph's own `metadata.ai_defaults` → `ollama`/`llama3`.
`--ai-force` overrides even nodes that pin their own provider.

---

## 🖥️ Graph Runner CLI

Run any graph JSON from the command line:

```bash
cd graph-runner
python run.py ../examples/hello_world.json
python run.py ../examples/text_transform.json
```

Override text input nodes:
```bash
python run.py my_graph.json --inputs my-text-node-id="Custom input text"
```

---

## 🚢 Deployment

There are two, independent kinds of "deploy" in AI-Graph.

### Deploying a graph

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

See [AGENTS.md](AGENTS.md#deploying-a-graph--vendored-runtime-bundles-not-codegen) for
exactly which files a bundle contains and why it can never drift from the editor.

### Deploying the editor itself

See [Option 3 – `start.py` launcher](#option-3--startpy-launcher): `python start.py --mode package` builds a zip of the editor app (backend + built frontend) to run on another server.

---

## 🧪 Running Tests

```bash
cd backend
pip install -r requirements.txt pytest pytest-asyncio
pytest tests/ -v
```

```bash
cd frontend
npm install
npm run test
```

Prefer adding to or extending an existing large, workflow-level test (a full graph run
through `execute_graph`, or a real vendored deploy bundle actually executed as a
subprocess) over adding a new test file per node type — see [AGENTS.md](AGENTS.md#tests).

To test a built executable rather than the source it came from — it starts the binary,
drives it over HTTP and shuts it down again:

```bash
python smoke_test_exe.py dist/ai-graph.exe
python smoke_test_exe.py dist/ai-graph.exe --standalone   # with Python stripped from PATH
```

### Continuous integration

`.github/workflows/ci.yml` runs the three checks above on every push and pull request.
`.github/workflows/release.yml` builds the Windows executable, smoke-tests that
artifact in both modes, and — when the push is a `v*` tag — attaches it to a GitHub
release; run it on demand from the Actions tab via **Run workflow**.

---

## 📁 Project Structure

```
AI-Graph/
├── AGENTS.md          # Codebase map for AI coding agents/contributors: which file to touch per node/widget kind
├── checkpoint.py       # Verify + package the editor in one command (see Quick Start)
├── backend/            # FastAPI Python backend (app/models, app/routers, app/elements, app/services)
├── frontend/            # React + TypeScript + ReactFlow frontend (src/elements, src/components, src/store)
├── graph-runner/        # run.py (CLI) / serve.py (GUI runtime) / build_exe.py — vendored verbatim into every deploy bundle
├── examples/            # Example graph JSON files
├── docker-compose.yml   # Full-stack deployment
└── README.md
```

For the detailed per-node-type/per-widget-kind file map (which class to edit for a
given change), see [AGENTS.md](AGENTS.md).
