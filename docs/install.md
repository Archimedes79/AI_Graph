# Installing and running AI-Graph

Four ways to run the editor, from a full Docker stack to a single executable, plus
how to run the test suites.

## Option 1 – Docker Compose (recommended)

```bash
git clone https://github.com/Archimedes79/AI_Graph.git
cd AI_Graph
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

## Option 2 – Development mode

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

## Option 3 – `start.py` launcher

A single Python script that starts both servers for you, no Docker required. It takes
no required arguments, so in VS Code you can just open `start.py` and press the ▷ Run
button (or `F5`) instead of typing a command:

```bash
python start.py               # dev mode: uvicorn --reload + vite dev server
python start.py --mode prod   # prod mode: one process serving API + built UI on :8000
```

Dev mode serves the editor at <http://127.0.0.1:3000> and the API at
<http://127.0.0.1:8000>. If the port is already taken, an earlier `start.py` is still
running — stop that one first, since two instances cannot share it.

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

## Option 4 – standalone executable

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

## Running Tests

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
subprocess) over adding a new test file per node type — see [AGENTS.md](../AGENTS.md#tests).

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
