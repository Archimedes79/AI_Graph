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
server serves a deployed tool, with the editor's routes simply not loaded.

## Two processes, one contract

AI-Graph runs in two places: **Node**, which runs graphs and touches files, models and
programs, and **the browser**, which draws them. They talk over HTTP, and the whole
conversation is written down once, in [`engine/src/host/api.ts`](../engine/src/host/api.ts):
every route with its method, path, audience and the types going each way. Both ends are
built from that table, and mirror each other:

```
          browser (editor/src)                              Node (engine/src/host)
 ┌──────────────────────────────────┐              ┌──────────────────────────────────────┐
 │ components, store, runtime page  │              │ serve.ts     the server: page + table │
 │        │                         │              │   ├─ toolRoutes()   the `tool` rows    │
 │        ▼                         │              │   └─ editor/routes.ts  the `editor`    │
 │ utils/api.ts                     │   HTTP/JSON  │        rows, loaded only for the editor│
 │   call('startRun', graph)  ──────┼──────────────┼──▶ handlers.startRun(request)          │
 │   ◀── ResponseOf<'startRun'>     │              │        │                               │
 └──────────────┬───────────────────┘              └────────┼──────────────────────────────┘
                │          ┌────────────────────────────┐   │
                └─imports─▶│ host/api.ts  API table,     │◀──┘ imports
                           │ Request/Response types,     │
                           │ matchRoute / pathFor        │
                           └────────────────────────────┘
```

- **The server serves exactly the table.** `serve.ts` refuses to start if a route has no
  handler, so a route cannot be declared and forgotten. A `tool` route is answered by every
  server; an `editor` route only when the editor's handlers are loaded, and with 404
  otherwise. `serve.test.ts` walks the table against a deployed tool.
- **The page calls the table by name.** `call('run', { id })` — the path, method and the
  shapes come from the table, so the compiler checks both ends against the same types. A
  failure is an `ApiError` whose message is the server's own `detail`.
- **The graph document is the engine's.** `engine/src/graph.ts` defines ports, edges, node
  types, block kinds and a run's result; `editor/src/types/graphModel.ts` imports them and
  adds one narrowing — each element's settings spelled out in `NodeConfig` — for its config
  panels. An editor graph *is* an engine graph and is sent as one; a graph read back is
  taken as the editor's view in one place (`EditorView` in `utils/api.ts`).

The table replaced two hand-kept descriptions that had drifted: the deployed tool's
settings dialog read fields the server never sent and saved to a route that did not
exist, and its file picker expected entries with names and got entries without.

## Modules, by side

Each part has a diagram whose every box is mapped to its files, in [`arch/`](../arch/):
[overview](../arch/overview.md) · [server](../arch/engine-host.md) ·
[browser](../arch/editor.md) · [elements](../arch/elements.md).

```
engine/src
  graph.ts          the document: types, parseGraph, applyMemory
  executor.ts       a run: order · collect · run · settle · display
  triggers.ts       what starts a run, and which slice of the graph it runs
  element.ts        what a node or a block is (the class hierarchy below)
  elements/<kind>/  one folder per kind: element.ts (Node) + editor/ (browser half)
  registry.ts       the roster: type name → element
  ai/               model providers, MCP client, settings file
  host/             the only part that knows an OS exists
    api.ts            the contract (above)
    http.ts           Refusal, Download, reading and writing a request
    serve.ts          the server and the `tool` routes
    runs.ts           RunBoard: runs in flight, watched and stopped
    schedule.ts       on start / every N, server-side
    node.ts           files · sandboxed code · models: the Runtime
    editor/           never bundled: routes.ts, generation, project files, settings, MCP server

editor/src
  utils/api.ts      the contract's client (above)
  types/            the graph as the editor holds it
  store/            graphStore: the open graph, runs, undo
  elements/         registry of element definitions; shared/ = the authoring UI all share
  components/       canvas, node editor, toolbar, the page designer (gui/)
  runtime/          the deployed tool's page: RuntimeApp, reachable without any editor module
  services/         the page-wide generation sweep
```

## The element hierarchy

Behaviour lives in classes, one per node type and per block kind. Shared code asks the
element and never switches on a type name.

```
Element<Subject, Config>                   config() · ports · execute() · generation() · catchesErrors()
├── GraphNodeElement<C>                    a node: derivedPorts · display · runtimeRequirements · settleMemory
│   ├── InputElement   AiElement   CodeElement   DataElement   OutputElement
│   └── GuiElement                         a composite: holds blocks, its ports are theirs
└── WidgetElement<C>                       a block on a page: ports · firesRun · settle · displayValue
    ├── InputPickerElement  TextIoElement  SelectElement  SliderElement  ButtonElement  ChatElement
    ├── StaticWidget        TextWidgetElement  DividerElement  SpacerElement
    └── DisplayWidget → TransformingDisplay   PlotWindowElement  TableElement  ImageViewElement
```

An element is handed its services (`Runtime`: `files`, `code`, `ai`, `tools`) rather than
reaching for them, and its browser half — the config panel, the block's widget — sits in the
same folder under `editor/`, registered in `editor/src/elements/registry.ts`.

## Five rules

**1. An element owns everything about its kind.** One class per node type and per block
kind (`elements/<kind>/element.ts`): its settings (`config()`), its ports, what it does
(`execute`), what it shows (`display`), how an AI writes its body (`generation()`), and
what a good generated result looks like (`Generation.check`). Adding a kind adds a folder
and one line in a roster (`registry.ts`, `gui/children/index.ts`), and nothing else changes.

**2. The executor owns everything about a run.** Ordering, fan-out over lists, reading
wired files, catching failures, stopping, idle-skipping, settling memory, and asking for
displays are done once, in `executor.ts`, for every element alike. An element declares
(`batchMode`, `readsFileInputs`, `catchesErrors`, `needsInput`, `isMemory`,
`settlesOnArrival`); the executor carries out.

**3. Services are passed in.** An element touches the world only through the `Runtime` it
is handed. That is why the same element runs on the server, in the editor's browser tab
(for ports and previews) and in a test with fakes.

**4. The import graph is the deployment boundary.** A bundle is a *copy* of `engine/src`
minus every `editor/` folder and every test, plus the chunks `runtime.html` references.
Nothing under an `editor/` folder may be imported statically from outside one (`serve.ts`
loads `editor/routes.ts` with `await import`). Tests enforce both halves: `bundle.test.ts`,
`runtime/boundary.test.ts`, `strippable.test.ts` (no TypeScript feature that needs a
compiler: no enums, no parameter properties).

**5. One implementation, replayed — never two that agree.** Where one side needs what the
other knows, it imports it or replays its result:

| The browser needs | It gets it from |
|---|---|
| every route, request and response | `host/api.ts` |
| the graph's types | `graph.ts` |
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
5. **Watching and stopping.** `RunBoard` (`host/runs.ts`) starts a run in the background,
   turns the executor's progress events into the `RunSnapshot` the page polls, and aborts
   it on Stop. An `AbortSignal` reaches every model call and every sandboxed body; no
   element knows stopping exists.

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
element's `check` → repair once with the evidence. Every model call is recorded (`AICall`)
and can be watched while it runs (`generationProgress`); the result waits for the person
to accept it. The plot block's check (`plot_window/check.ts`) looks at the SVG without a
screen: viewBox, NaN, empty frame, coordinates outside the box.

## Where state lives

| State | Lives in | Travels as |
|---|---|---|
| the graph | `graph.json` (+ optional `<graph>.nodes/*.js|md`) | the document |
| a block's value, a conversation, a data node's value | inside the graph, in the element's own config | `result.memory` → `applyMemory` |
| a run in flight | `RunBoard` on the server | `RunSnapshot`, polled |
| the last run | the editor's store / the served page / `schedule.ts` | `ExecutionResult` |
| keys, endpoints, MCP servers that start programs | `ai-settings.json`, machine-side, never in a graph | — |
| which model writes code for you | the browser (`settingsStore`) | request fields (`ModelChoice`) |

## Security boundaries

- Everything binds to loopback; file browsing and "open in my editor" switch off otherwise.
- The `for` column of the contract is the line between a deployed tool and the editor: a
  deployed tool answers its graph, run/watch/stop, a file picker and a read-only view of
  its AI settings — no generation, no editing, no writing settings.
- A code body runs in a separate Node process under `--permission`: files yes; child
  processes, addons, workers no. The network is **not** closed (Node has no flag for it).
- A graph can *name* an MCP tool server; only `ai-settings.json` can say which program a
  name starts. A URL is called directly.
- The MCP **server** (`host/editor/mcpServer.ts`) confines every path to one root, writes
  only `.json` graphs, never reads settings, and filters keys out of everything it returns.

## Keeping it clean

- Both packages compile with `noUnusedLocals` and `noUnusedParameters`: an unused import,
  variable or parameter is a build error, not a lint warning.
- Things that were settable and did nothing have been removed rather than documented: a
  per-port "debug directory" the engine never read, a run duration it never sent, a deploy
  preview window nothing opened.

## Known debt

- **`NodeConfig` is one type for six node kinds** (`editor/src/types/graphModel.ts`), and
  `baseNodeConfig()` gives every new node every field, so a saved graph carries keys its
  node never reads. Harmless to the engine (elements pick what they know), noisy in diffs.
  The fix is per-element `create()` defaults plus optional fields in the type; it touches
  every config panel, which is why it has not been done in passing.
- **Element editors live under `engine/src/elements/*/editor/`** and import the editor
  package (`@/…`). Deliberate — an element's two halves sit in one folder — but it means
  `engine/` contains React. The bundle walk and the boundary tests keep it out of bundles.
- **Partial runs re-run upstream nodes** rather than reusing their last outputs. Correct,
  and cheap for readers and pages; a cache keyed on inputs would be the next step.
- **No server-side persistence of scheduled results** beyond the process's lifetime, and no
  ingest endpoint: a scheduled tool is a clock around a run, not a monitoring system.
