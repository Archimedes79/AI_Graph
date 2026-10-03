# Installing and running AI-Graph

One runtime: Node 24 or newer. The engine is TypeScript that Node runs directly, so
there is no build step for it and no interpreter to find — a graph runs on any machine
that can run Node, and so does the editor. The version is written down in `.nvmrc` and in
each `package.json`, so `nvm use` picks it and npm says so when it is too old.

```bash
git clone https://github.com/Archimedes79/AI_Graph.git
cd AI_Graph
npm ci
```

## Running the editor

```bash
.\start.ps1       # PowerShell, which is what the VS Code terminal runs
start.cmd         # cmd.exe, or double-click the file
./start.sh        # macOS, Linux
```

Bare `start` does not work in PowerShell: there it is an alias for `Start-Process`,
which answers with a prompt for `FilePath:` and never touches this project. The
leading `.\` is what tells PowerShell to run the script in this folder.

Installs on first use, builds the page when it is missing, then serves it on
<http://127.0.0.1:8000> and opens a browser. The same by hand:

```bash
npm run build     # the editor's page, once (and after pulling changes to it)
npm start         # http://127.0.0.1:8000, opened in your browser
```

`npm start` is one process: the engine, serving the built page and answering the
editor's requests. It listens on loopback only.

Starting `start.cmd`, `start.ps1` or `start.sh` again while the editor is already
running stops the existing editor on the same port first, rebuilds the page when
editor or engine sources are newer, and starts one fresh instance. Only an AI-Graph
server is stopped: if another program holds the port, the launcher says so and leaves
it alone (`--port 8001` picks another). Closing the browser tab
does not stop the Node server. Use `stop.cmd`, `./stop.ps1` or `./stop.sh` to stop
it without restarting; Ctrl+C in its terminal and starting the launcher again also
stop/restart it.

## In VS Code

Three ways to start it, all from the GUI, all starting the editor empty:

- **Ctrl+Shift+B** runs the default build task, which is "start the editor".
- **Run and Debug** (Ctrl+Shift+D) -> "Start the editor (empty)" -> the green arrow,
  or just F5. This one attaches the debugger, so a breakpoint in an element's
  `execute()` is hit while a graph runs.
- **Terminal -> Run Task** lists the same npm scripts by name.

The other launch configurations run one graph without a browser anywhere, and run the
test file the cursor is in. Open the `AI_Graph` folder itself, not a folder above it:
VS Code reads `.vscode/` from the folder you opened.

## Working on the editor

```bash
npm run dev
```

Starts the engine on :8000 and Vite on :3000 in one terminal, so an edit to the editor
is visible on save. The page is at <http://127.0.0.1:3000>; `/api` is proxied to the
engine. Ctrl+C stops both.

If :3000 is already taken, an earlier `npm run dev` is still running — stop that one
first.

## The download, without a checkout

The [releases page](https://github.com/Archimedes79/AI_Graph/releases) has zips that
hold the engine's source, the editor's built page and the examples:

| Release | Zip | What it is |
|---|---|---|
| `vX.Y.Z` | `ai-graph-windows.zip`, `ai-graph-linux.zip` | A version for Windows or Linux on x64, with the Node.js it runs on in `node/`. Published when the tag is pushed, and never changed afterwards. `releases/latest/download/<name>` is always the newest. |
| `latest` (pre-release) | `ai-graph-latest.zip` | Whatever `main` is, without Node: for any computer with Node 24 or newer. Rebuilt on every green push to `main`, at an address that stays the same. |

The *Source code (zip)* GitHub adds to every release is the bare repository — no built
page and no `run.cmd` — and needs the checkout route above.

The engine has no runtime dependencies and Node runs its TypeScript unbuilt, so there is
nothing to install and nothing to build: unzip, then start `run.cmd` (Windows) or
`./run.sh` (Linux).

The launchers use the Node in `node/` where the folder has one, and otherwise the
computer's, which must then be 24 or newer: they check before starting, a missing or
older Node is named in a sentence, and on Windows the window stays open until it has been
read. The editor opens in the browser on port 8000, or the next free one if something —
another editor, say — is already there; `PORT=8123` insists on one. `VERSION` in the
folder says which build it is and which commit it came from.

`npm run package` builds the zip without Node from a checkout; `node scripts/package.mjs
out.zip --node <an unpacked Node download>` builds one with it. `node --test
scripts/package.test.mjs` unzips both and starts them the way a person would — the one
with Node on a computer whose only Node is too old — which CI does on Linux and Windows
before anything is published.

## In a container

```bash
docker compose up --build
```

Builds the editor, runs it on :8000 beside an Ollama container, and keeps
`./data` (the files your graphs read and write) outside the image. Pull a model once:

```bash
docker exec -it ai_graph-ollama-1 ollama pull llama3
```

The container binds `--host 0.0.0.0` because its loopback is its own, and Compose
publishes it on the host's loopback only (`127.0.0.1:8000:8000`). Keep it that way: the
editor runs code, reads and writes files and saves keys for whoever reaches it, and asks
nobody who they are, so a port published on every interface hands all of that to your
network. On such a bind the server also answers only a request addressed to `localhost`,
`127.0.0.1` or `[::1]`, whatever port led there, so a web page that points a name of its
own at the machine gets nowhere; a name you reach it by yourself — a reverse proxy's —
goes in `AI_GRAPH_ALLOWED_HOSTS`, comma-separated. The file browser switches itself off
there rather than list the host's filesystem.

### The published image

Every push to `main` that passes CI is built and pushed to GitHub's own registry, so a
checkout is not required to run the editor in a container:

```bash
docker run -p 127.0.0.1:8000:8000 -v ./data:/app/data ghcr.io/archimedes79/ai_graph:latest
```

A tagged release (`vX.Y.Z`) additionally publishes that version and its `X.Y`/`X`
shorthands, so a deployment can pin one instead of tracking `latest`. See
`.github/workflows/ci.yml`'s `publish` job for exactly what is built.

## Code nodes and the target machine

A code node is JavaScript and runs on the Node that runs the engine — nothing else to
install, and nothing installed while a graph runs. A bundle handed to someone else
needs Node on their machine, and that is the whole list.

It runs in its own process, started with Node's permission system on: files stay
readable and writable, because that is most of what a body is for, while starting
other programs, loading native addons, spawning workers and opening a debugger port
are refused. The network is not covered — Node has no flag for it — so a body can
still reach out. Its environment leaves out every variable named like a key, a token or
a password, so an `OPENAI_API_KEY` set for the engine is not a body's to read; a file
is, though, `ai-settings.json` included. `engine/src/host/sandbox.test.ts` asserts the
policy.

## Tests

```bash
npm test            # both suites
npm run typecheck   # both, with the compiler
```

Or one at a time: `npm test --workspace engine`, `npm test --workspace editor`.

Prefer adding to an existing workflow-level test — a real graph run through
`executeGraph`, a bundle actually written and executed — over a new file per element.
`engine/src/examples.test.ts` runs every example graph end to end; `bundle.test.ts`
writes a bundle and runs it from somewhere else entirely.

### Continuous integration

`.github/workflows/ci.yml` installs once at the root, type-checks and tests both
workspaces, and builds the editor's page, on every push and pull request.
