# Architecture

How AI-Graph is put together, which rules hold it together, and what is knowingly left
untidy. Read this before changing anything structural; the code comments explain the
*why* of each file, this explains how the files relate.

## The shape

```
engine/    runs a graph. TypeScript that Node executes by stripping types: no build, no dependencies.
editor/    the page: React + ReactFlow. Built on the engine, never the other way round.
examples/  graphs that are run, event-driven and deployed by the test suite.
scripts/   dev server, packaging, and the generator for the examples that carry real code.
```

One process serves everything: `node engine/src/main.ts --editor editor/dist`. The same
`serve.ts` serves a deployed tool, with the editor's routes simply not loaded.

```
                        ┌──────────── engine/src ─────────────┐
 graph.json ──parse──▶  │ graph.ts      the document           │
                        │ executor.ts   order · collect · run  │──▶ ExecutionResult
                        │ triggers.ts   what starts a run      │     node_results[] · memory[] · display
                        │ element.ts    what a node/block is   │
                        │ elements/*    one folder per kind    │
                        │ ai/           providers · MCP client │
                        │ host/         the only part that knows an OS exists
                        │   node.ts       files · sandbox · model   (the Runtime)
                        │   serve.ts      HTTP: run, watch, stop, page
                        │   schedule.ts   on start / every N, server-side
                        │   editor/       generation, project files, settings, MCP server  ← never bundled
                        └──────────────────────────────────────┘
```

## Five rules

**1. An element owns everything about its kind.** One class per node type and per block
kind (`elements/<kind>/element.ts`): its settings (`config()`), its ports, what it does
(`execute`), what it shows (`display`), how an AI writes its body (`generation()`), and
what a good generated result looks like (`Generation.check`). Shared code asks the
element; it never switches on a type name. Adding a kind adds a folder and one line in a
roster (`registry.ts`, `gui/children/index.ts`), and nothing else changes.

**2. The executor owns everything about a run.** Ordering, fan-out over lists, reading
wired files, catching failures, stopping, idle-skipping, settling memory, and asking for
displays are done once, in `executor.ts`, for every element alike. An element declares
(`batchMode`, `readsFileInputs`, `catchesErrors`, `needsInput`, `isMemory`,
`settlesOnArrival`); the executor carries out.

**3. Services are passed in.** An element touches the world only through the `Runtime` it
is handed — `files`, `code`, `ai`, `tools`. That is why the same element runs on the
server, in the editor's browser tab (for ports and previews) and in a test with fakes.

**4. The import graph is the deployment boundary.** A bundle is a *copy* of `engine/src`
minus every `editor/` folder and every test, plus the chunks `runtime.html` references.
Nothing under an `editor/` folder may be imported statically from outside one (`serve.ts`
and `cli.ts` use `await import`). Tests enforce both halves: `bundle.test.ts`,
`runtime/boundary.test.ts`, `strippable.test.ts` (no TypeScript feature that needs a
compiler).

**5. One implementation, replayed — never two that agree.** Where the editor needs what
the engine knows, it calls the engine's code or replays the engine's result:

| The editor needs | It gets it from |
|---|---|
| a page node's ports | `GuiElement.derivedPorts` via `utils/guiWidgets.ts` |
| whether a block starts the graph | `WidgetElement.firesRun` |
| the request an AI node will send | `assemblePrompt` (`elements/ai/prompt.ts`) |
| what a run remembered | `ExecutionResult.memory`, replayed with `applyMemory` |
| what a block shows | `NodeResult.display` |
| the order to generate a graph in | `topologicalLevels` |

Each row used to be a second implementation in the editor, and each had drifted.

## A run

1. **Order.** Kahn's algorithm gives levels. A loop through a node that remembers (a page,
   a data node) is legal: the fewest edges into memory nodes are left out of the ordering
   (`memoryFeedbackEdges`) and settled after the round.
2. **What runs.** Everything — or, for a page event, the nodes its port is wired to, what
   follows from them, and what those need upstream (`triggers.ts`). An edge into the
   undeclared `__run` port orders a node and carries nothing.
3. **Per node.** Collect inputs → idle-skip if a required or (for an AI node) every wired
   input came up empty → read wired files → run once, or once per item → record.
   A failure marks the node and skips its dependents; with `catch_errors` it becomes an
   `error` output instead.
4. **After the round.** `settleMemory` hands loop values to the nodes that keep them and
   lists every write in `result.memory`. Then `showDisplays` asks each page node what it
   shows, *with* those values — which is what makes a chart's transform work on a page
   that also holds the chart's controls.
5. **Stopping.** An `AbortSignal` is put on every model call and handed to every sandboxed
   body by the executor; no element knows stopping exists.

`executeNode` (one node on given inputs) and `inputsFor` (run what feeds a node, not the
node) are the same machinery, and are what the editor's **Try it** panel uses.

## Authoring: one loop for every element

Every element that has a body — an AI node's prompt, a code node, a chart's transform, a
file selector — is written the same way, in `AuthoredBodyEditor` + `TryItPanel`:

```
what it should do ──✨──▶ body ──▶ Try it: [values] ⟳ from the graph · ▶ Test ──▶ what came out
                            ▲                │
                            └── verified ────┘   the same values are the sample ✨ is
                                                 written and checked against (tryValues.ts)
```

Generation (`host/editor/generate.ts`) is: write → run once on the sample → ask the
element's `check` → repair once with the evidence. The plot block's check
(`plot_window/check.ts`) looks at the SVG without a screen: viewBox, NaN, empty frame,
coordinates outside the box. Colour is described to the model (`describeScheme`), never
policed.

## Where state lives

| State | Lives in | Travels as |
|---|---|---|
| the graph | `graph.json` (+ optional `<graph>.nodes/*.js|md`) | the document |
| a block's value, a conversation, a data node's value | inside the graph, in the element's own config | `result.memory` → `applyMemory` |
| the last run | the editor's store / the served page / `schedule.ts` | `ExecutionResult` |
| keys, endpoints, MCP servers that start programs | `ai-settings.json`, machine-side, never in a graph | — |
| which model writes code for you | the browser (`settingsStore`) | request fields |

## Security boundaries

- Everything binds to loopback; file browsing and "open in my editor" switch off otherwise.
- A code body runs in a separate Node process under `--permission`: files yes; child
  processes, addons, workers no. The network is **not** closed (Node has no flag for it).
- A graph can *name* an MCP tool server; only `ai-settings.json` can say which program a
  name starts. A URL is called directly.
- The MCP **server** (`host/editor/mcpServer.ts`) confines every path to one root, writes
  only `.json` graphs, never reads settings, and filters keys out of everything it returns.
- A deployed tool offers: its graph, run/watch/stop, a file picker. No generation, no
  editing — the list is written out in `serve.ts` on purpose.

## Known debt

- **`NodeConfig` is one type for six node kinds** (`editor/src/types/graphModel.ts`), and
  `baseNodeConfig()` gives every new node every field, so a saved graph carries keys its
  node never reads. Harmless to the engine (elements pick what they know), noisy in diffs.
  The fix is per-element `create()` defaults plus optional fields in the type; it touches
  every config panel, which is why it has not been done in passing.
- **Element editors live under `engine/src/elements/*/editor/`** and import the editor
  package (`@/…`). Deliberate — an element's two halves sit in one folder — but it means
  `engine/` contains React. The bundle walk and the boundary tests keep it out of bundles.
- **`serve.ts` is a chain of `if`s.** It is short enough to read top to bottom and the
  route list is a security boundary worth seeing in one place; a table would be tidier.
- **Partial runs re-run upstream nodes** rather than reusing their last outputs. Correct,
  and cheap for readers and pages; a cache keyed on inputs would be the next step.
- **No server-side persistence of scheduled results** beyond the process's lifetime, and no
  ingest endpoint: see "What it is not" in the README before building monitoring on it.
