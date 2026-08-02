# AI-Graph

**AI-Graph** is a no-code, node-based AI workflow orchestration platform: connect nodes
on a visual canvas to build data/AI pipelines, describe a graph as a portable JSON DSL,
generate or edit it with AI, run it locally, or compile it into a standalone deployable
service — without hand-writing glue code.

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
  `graph-runner` CLI, or compiled into a single dependency-free script; behavior must
  stay identical across all three.
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
  AI-generated `run(inputs)`) → Merge/Split → Output; see `examples/text_transform.json`.
- **Local-LLM chat or report tool** — an AI node backed by Ollama/LM Studio (no cloud
  dependency) fed by File/Directory Input, paired with a `gui` node's
  `chat_window`/`text_window` widgets for a runnable front-end with zero UI code.
- **Ad-hoc data dashboards** — a `gui` node's `plot_window` widget charts an upstream
  node's output directly, with an optional AI-generated transform snippet reshaping raw
  data into plot-ready points.
- **Deploying a graph as a standalone tool** — once a graph works in the editor,
  **🚀 Deploy** compiles it into one self-contained script (or a Docker Compose bundle)
  that a non-technical user or CI job can run without the AI-Graph editor at all.

For where to make a given code change (which file to touch per node type/widget kind),
see [AGENTS.md](AGENTS.md).

---

## ✨ Features

- **Visual Graph Editor** – drag-and-drop node canvas powered by ReactFlow
- **Node Types**:
  - **Text / File / Directory Input** – load data from configured sources; Directory Input only lists rooted file paths, it does not read content
  - **AI Node** – send prompts to Ollama (local LLM), OpenAI, an OpenAI-compatible endpoint, or Anthropic
  - **Code Node** – execute generated or hand-written Python/JavaScript
  - **Read File (Code) / Read File (AI)** – presets that auto-resolve `file_path` inputs to actual content before running
  - **Output** – capture results
  - **Merge / Split** – fan-in and fan-out multiple connections, with concat/sum/count/json_list aggregation modes on Merge
- **AI Code Generation** – describe what a node should do; the AI writes the code
- **AI Prompt Generation** – describe the AI's role; get a system prompt generated
- **Fan-in / Fan-out** – connect one output to many inputs, or merge many into one
- **Graph DSL** – graphs are JSON files; readable and writable by humans and AI alike
- **Execution Engine** – topological execution with full per-node status reporting
- **Deployment Tooling** – export a Docker Compose stack + standalone runner script
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

A single Python script that starts both servers for you, no Docker or VS Code required:

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

---

## 📖 Graph DSL

Graphs are stored as JSON and can be created, modified, or generated by an AI:

```json
{
  "metadata": { "name": "My Graph", "version": "1.0.0" },
  "nodes": [
    {
      "id": "n1",
      "node_type": "text_input",
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
ports are regenerated to match (`sync_gui_node_ports` in `app/models/graph.py`, mirrored
in `frontend/src/utils/guiWidgets.ts`). This is the core interface contract: **a GUI
node's inputs and outputs always reflect exactly what its widgets are capable of.**

| Widget kind | Ports it contributes |
|---|---|
| `file_open` | 1 output (file path) |
| `directory_open` | 1 output (list of file paths, filtered by `extensions`) |
| `text_window` | 1 input + 1 output (text passthrough; incoming wins over the widget's own `value`) |
| `chat_window` | 1 input + 1 output (text passthrough) |
| `plot_window` | 1 input only — display-only, no downstream port, like `text_output` |

Each widget's ports are named `f"{widget.id}_in"` / `f"{widget.id}_out"`, so a widget's
`id` must stay stable once assigned — that's the only thing keeping existing edges
attached across GUI edits.

### Plot window data transforms

`plot_window` accepts an optional data-transform snippet (`widget.code` /
`widget.language`), following the **same contract as a Code node**:
`run(inputs: dict) -> dict`, receiving `{"value": <raw incoming data>}` and returning
`{"value": <plot-ready data>}` — a list of numbers, or a list of `{x, y}` /
`{label, value}` objects. It runs through the same sandboxed `code_executor` as Code
nodes (`app/services/executors/gui.py`). Leaving `code` empty passes the raw incoming
value straight through to the chart (a dependency-free inline SVG component,
`frontend/src/components/PlotWidget.tsx`). The GUI widget editor
(`frontend/src/components/GuiWidgetEditor.tsx`) can call the AI to generate this
transform via the same `/api/ai/generate-code` endpoint used elsewhere — no separate
endpoint is needed.

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
| OpenAI | gpt-4o, gpt-4-turbo, … | `OPENAI_API_KEY` |
| Anthropic | claude-3-5-sonnet, … | `ANTHROPIC_API_KEY` |
| OpenAI-compatible endpoint | Any compatible model | `OPENAI_COMPATIBLE_BASE_URL`, optional `OPENAI_COMPATIBLE_API_KEY` |

Set environment variables in a `.env` file or pass them to Docker Compose.

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

There are two, independent kinds of "deploy" in AI-Graph:

### Deploying a graph

From the frontend toolbar, click **🚀 Deploy** to:

- **Download Bundle** – get a zip containing `run_graph.py` (self-contained runner, no `graph.json` or AI-Graph backend needed at runtime), `requirements.txt`, `Dockerfile`, `docker-compose.yml`, and a `README.md` with run instructions
- **View Docker Compose** – preview the generated compose file

Or use the API:

```bash
curl -X POST http://localhost:8000/api/deploy/bundle \
  -H "Content-Type: application/json" \
  -d @my_graph.json \
  --output bundle.zip
```

### Deploying the editor itself

See [Option 3 – `start.py` launcher](#option-3--startpy-launcher): `python start.py --mode package` builds a zip of the editor app (backend + built frontend) to run on another server.

---

## 🧪 Running Tests

```bash
cd backend
pip install -r requirements.txt pytest pytest-asyncio
pytest tests/ -v
```

Prefer adding to or extending an existing large, workflow-level test (a full graph run
through `execute_graph`, or a compiled deploy script actually executed) over adding a new
test file per node type — see [AGENTS.md](AGENTS.md#tests).

---

## 📁 Project Structure

```
AI-Graph/
├── AGENTS.md             # Codebase map for AI coding agents (which file to touch per node/widget kind)
├── backend/              # FastAPI Python backend
│   ├── app/
│   │   ├── main.py       # FastAPI app entry point
│   │   ├── models/       # Graph DSL Pydantic models (NodeType/GuiWidgetKind contracts)
│   │   ├── routers/      # API routes (graph, execute, ai, deploy)
│   │   └── services/
│   │       ├── graph_executor.py   # topology/batching/format resolution; dispatches to executors/
│   │       ├── executors/          # one file per node type: live execution logic
│   │       ├── gui_widgets/        # one file per GUI widget kind: live execution logic
│   │       ├── deploy_service.py   # deploy-bundle assembly; dispatches to deploy/node_compilers/
│   │       ├── deploy/
│   │       │   ├── node_compilers/         # one file per node type: deploy-script codegen
│   │       │   └── gui_widget_compilers/   # one file per GUI widget kind: deploy-script codegen
│   │       ├── ai_service.py, code_executor.py, file_service.py  # cross-cutting helpers
│   ├── tests/            # Backend tests — prefer large workflow-level tests (see AGENTS.md)
│   └── requirements.txt
├── frontend/             # React + TypeScript + ReactFlow frontend
│   └── src/
│       ├── components/
│       │   ├── NodeEditor.tsx        # modal shell; dispatches to nodes/editors/
│       │   ├── nodes/editors/        # one file per node type: config panel
│       │   ├── GuiWidgetEditor.tsx   # widget list; dispatches to widgets/editors/
│       │   └── widgets/editors/      # one file per GUI widget kind: config panel
│       ├── store/        # Zustand state management
│       ├── types/        # TypeScript graph types (mirrors backend/app/models/graph.py)
│       └── utils/        # API client, node defaults
├── graph-runner/         # CLI tool for executing graphs
│   └── run.py
├── examples/             # Example graph JSON files
├── docker-compose.yml    # Full-stack deployment
└── README.md
```
