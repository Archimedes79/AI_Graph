# Installing and running AI-Graph

One runtime: Node 24 or newer. The engine is TypeScript that Node runs directly, so
there is no build step for it and no interpreter to find — a graph runs on any machine
that can run Node, and so does the editor.

```bash
git clone https://github.com/Archimedes79/AI_Graph.git
cd AI_Graph
npm ci
```

## Running the editor

```bash
start.cmd         # Windows -- type the extension, or double-click the file
./start.sh        # everywhere else
```

Installs on first use, builds the page when it is missing, then serves it on
<http://127.0.0.1:8000> and opens a browser. The same by hand:

```bash
npm run build     # the editor's page, once (and after pulling changes to it)
npm start         # http://127.0.0.1:8000, opened in your browser
```

`npm start` is one process: the engine, serving the built page and answering the
editor's requests. It listens on loopback only.

## Working on the editor

```bash
npm run dev
```

Starts the engine on :8000 and Vite on :3000 in one terminal, so an edit to the editor
is visible on save. The page is at <http://127.0.0.1:3000>; `/api` is proxied to the
engine. Ctrl+C stops both.

If :3000 is already taken, an earlier `npm run dev` is still running — stop that one
first.

## In a container

```bash
docker compose up --build
```

Builds the editor, runs it on :8000 beside an Ollama container, and keeps
`./data` (attachments) outside the image. Pull a model once:

```bash
docker exec -it ai_graph-ollama-1 ollama pull llama3
```

The container binds `--host 0.0.0.0` because its loopback is its own. On a
non-loopback bind the file browser switches itself off rather than expose the host's
filesystem listing to the network; everything else works.

### The published image

Every push to `main` that passes CI is built and pushed to GitHub's own registry, so a
checkout is not required to run the editor in a container:

```bash
docker run -p 8000:8000 -v ./data:/app/data ghcr.io/archimedes79/ai_graph:latest
```

A tagged release (`vX.Y.Z`) additionally publishes that version and its `X.Y`/`X`
shorthands, so a deployment can pin one instead of tracking `latest`. See
`.github/workflows/ci.yml`'s `publish` job for exactly what is built.

## Code nodes and the target machine

A code node is JavaScript and runs on the Node that runs the engine — nothing else to
install, and nothing installed while a graph runs. A bundle handed to someone else
needs Node on their machine, and that is the whole list.

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
