# Architecture

How AI-Graph is put together, which rules hold it together, and what is knowingly left
untidy. Read this before changing anything structural; the code comments explain the
*why* of each file, this explains how the files relate. Diagrams with every box mapped to
its files are in [`arch/`](../arch/overview.md).

## The shape

```
engine/    runs a graph. TypeScript that Node executes by stripping types: no build, no dependencies.
editor/    the page: React + ReactFlow. Built on the engine, never the other way round.
examples/  graphs that are run, event-driven and deployed by the test suite.
scripts/   dev server, packaging, and the generator for the examples that carry real code.
arch/      the architecture diagrams.
```

One process serves everything: `node engine/src/main.ts --editor editor/dist`. The same
server serves a deployed tool, with the editor's routes simply not loaded.

## Elements first

Everything the tool can do is an **element**: a node type (input, ai, code, data, output,
gui) or a widget kind on a page (text, picker, dropdown, chart, chat, …). The design is
organised around them, and each element is one folder, at the **same relative path on
both sides**:

```
engine/src/elements/                       editor/src/elements/
  Element.ts   GraphNodeElement.ts           ElementUi.ts         the contract each half fills in
  WidgetElement.ts  Runtime.ts               registry.ts          mirrors the engine's registry
  registry.ts  port.ts  fileSelection.ts     fields/              settings shared by several panels
  nodes/                                     nodes/
    ai/     AiNode.ts  prompt.ts               ai/     AiNode.ui.ts  AiNodePanel.tsx
                                                       AiNodeAdvancedPanel.tsx  PromptPreview.tsx
    code/   CodeNode.ts                        code/   CodeNode.ui.ts  CodeNodePanel.tsx …
    data/ gui/ input/ output/                  data/ gui/ input/ output/
  widgets/                                   widgets/
    select/ SelectWidget.ts                    select/ SelectWidget.ui.ts  SelectWidgetView.tsx
                                                       SelectWidgetPanel.tsx
    plot_window/ PlotWindowWidget.ts           plot_window/ PlotWindowWidget.ui.ts
                 check.ts  view.ts                          PlotWindowWidgetView.tsx
                                                            PlotWindowWidgetPanel.tsx  PlotChart.tsx
    …  StaticWidget.ts  DisplayWidget.ts       …  WidgetView.ts
       TransformingDisplay.ts  roster.ts
```

**Names follow the file format, mechanically.** Node type `ai` is class `AiNode` in
`nodes/ai/AiNode.ts`; widget kind `plot_window` is class `PlotWindowWidget` in
`widgets/plot_window/PlotWindowWidget.ts`. One class per file, and the file is named after
it. Each element has a fixed set of **facets**, told apart by suffix:

| Facet | Engine (Node) | Editor (browser) |
|---|---|---|
| What it is and does: config, ports, `execute`, `generation` | `<Kind>Node.ts` / `<Kind>Widget.ts` | — |
| How it looks on a page — the designer and the deployed tool draw the same component | — | `<Kind>WidgetView.tsx` |
| Its settings | — | `<Kind>NodePanel.tsx` / `<Kind>WidgetPanel.tsx` |
| What the editor's shells ask of it | — | `<Kind>Node.ui.ts` / `<Kind>Widget.ui.ts` |

A node's look on the canvas is generic (`canvas/GraphNodeView.tsx`), so nodes have no view
of their own. [`symmetry.test.ts`](../editor/src/elements/symmetry.test.ts) holds the two
sides to this: both registries list the same kinds, and every element has its files, under
its names, on both sides.

## The element hierarchy

Behaviour lives in classes. Shared code asks the element and never switches on a type name.

```
Element<Subject, Config>                 config() · generation() · catchesErrors() · deployNeeds()
├── GraphNodeElement<C>                  a node: derivedPorts · execute · display · runtimeRequirements · settleMemory
│   ├── InputNode  AiNode  CodeNode  DataNode  OutputNode
│   └── GuiNode                          a composite: holds widgets, its ports are theirs
└── WidgetElement<C>                     a widget: ports · execute · firesRun · settle · displayValue
    ├── InputPickerWidget  TextIoWidget  SelectWidget  SliderWidget  ButtonWidget  ChatWidget
    ├── StaticWidget → TextWidget  DividerWidget  SpacerWidget
    └── DisplayWidget → TransformingDisplay → PlotWindowWidget  TableWidget  ImageViewWidget
```

The browser half mirrors it as data, not as subclasses: `NodeUi` and `WidgetUi`
(`ElementUi.ts`) are filled in by each element's `.ui.ts`. An element is handed its
services (`Runtime.ts`: `files`, `code`, `ai`, `tools`) rather than reaching for them.

## Two processes, one contract

AI-Graph runs in two places: **Node**, which runs graphs and touches files, models and
programs, and **the browser**, which draws them. They talk over HTTP, and the whole
conversation is written down once, in [`engine/src/host/api.ts`](../engine/src/host/api.ts):
every route with its method, path, audience and the types going each way. Both ends are
built from that table, and mirror each other:

```
          browser (editor/src)                              Node (engine/src/host)
 ┌──────────────────────────────────┐              ┌──────────────────────────────────────┐
 │ app, canvas, page, runtime page  │              │ serve.ts     the server: page + table │
 │        │                         │              │   ├─ toolRoutes()   the `tool` rows    │
 │        ▼                         │              │   └─ editor/routes.ts  the `editor`    │
 │ api/client.ts                    │   HTTP/JSON  │        rows, loaded only for the editor│
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
  handler. A `tool` route is answered by every server; an `editor` route only when the
  editor's handlers are loaded, and with 404 otherwise.
- **The page calls the table by name.** `call('run', { id })` — path, method and shapes come
  from the table, so the compiler checks both ends against the same types. A failure is an
  `ApiError` whose message is the server's own `detail`.
- **The graph document is the engine's.** [`engine/src/graph.ts`](../engine/src/graph.ts)
  defines ports, edges, node types, widget kinds and a run's result;
  [`editor/src/graph.ts`](../editor/src/graph.ts) imports them and adds one narrowing — each
  element's settings spelled out in `NodeConfig` — for its panels.

## Modules, by side

```
engine/src                               editor/src
  main.ts            the entry point       main.tsx  App.tsx   the editor's entry and shell
  graph.ts           the document          graph.ts            the document, as the editor holds it
  elements/          see above             elements/           see above
  authoring/         how a body is         authoring/          writing a body: ✨ Generate, Try it,
    generation.ts    written, where it       AuthoredBodyEditor  the live transcript, the page-wide
    logic.ts         is kept, who runs it    TryItPanel …        sweep (graphSweep.ts)
    describe.ts
  execution/         running a graph       canvas/             the graph on screen: GraphCanvas,
    executor.ts      order · run · settle    GraphNodeView       GraphNodeView, NodeEditor
    triggers.ts      what starts a run     page/               a gui node's page: GuiPage (drawn by
    batching.ts  fileInputs.ts               GuiPage             the editor and the tool alike),
    runtimeValues.ts  images.ts              DesignerTab …       the designer, layout, schemes
  host/              Node and HTTP         api/client.ts       the contract's client
    api.ts           the contract          app/                toolbar, sidebar, dialogs, results
    serve.ts  http.ts  runs.ts             store/              the open graph, runs, undo
    schedule.ts  node.ts                   runtime/            the deployed tool's page
    editor/          never bundled         ui/                 theme, Modal, Markdown, dialogs
  ai/                providers · MCP · settings
  cli/               cli.ts  bundle.ts
```

Within `editor/src` an import inside one area (`canvas/`, `page/`, …) is relative; one that
crosses areas goes through `@/`, and one into the engine through `@engine/`.

## Five rules

**1. An element owns everything about its kind.** Its settings (`config()`), its ports,
what it does (`execute`), what it shows (`display`), how an AI writes its body
(`generation()`), and what a good result looks like (`Generation.check`) — in its own
class. Adding a kind adds one folder on each side and one line in each registry
(`elements/registry.ts` and `widgets/roster.ts` in the engine, `elements/registry.ts` in
the editor), and nothing else changes.

**2. The executor owns everything about a run.** Ordering, fan-out over lists, reading
wired files, catching failures, stopping, idle-skipping, settling memory, and asking for
displays are done once, in `execution/executor.ts`, for every element alike. An element
declares (`batchMode`, `readsFileInputs`, `catchesErrors`, `needsInput`, `isMemory`,
`settlesOnArrival`); the executor carries out.

**3. Services are passed in.** An element touches the world only through the `Runtime` it
is handed. That is why the same element runs on the server, in the editor's browser tab
(for ports and previews) and in a test with fakes.

**4. The import graph is the deployment boundary.** A bundle is a *copy* of `engine/src`
minus `host/editor/` and every test, plus the chunks `runtime.html` references. The
engine contains no React at all. On the page side, a deployed tool draws widgets with
their views and never loads a panel: panels are registered with `lazy(() => import(…))`,
so each is a chunk of its own that only the editor fetches. Tests hold all of it:
`cli/bundle.test.ts`, `runtime/boundary.test.ts`, `strippable.test.ts` (no TypeScript
feature that needs a compiler: no enums, no parameter properties).

**5. One implementation, replayed — never two that agree.** Where one side needs what the
other knows, it imports it or replays its result:

| The browser needs | It gets it from |
|---|---|
| every route, request and response | `host/api.ts` |
| the graph's types | `graph.ts` |
| a page node's ports | `GuiNode.derivedPorts` via `elements/nodes/gui/guiWidgets.ts` |
| whether a widget starts the graph | `WidgetElement.firesRun` |
| the request an AI node will send | `assemblePrompt` (`elements/nodes/ai/prompt.ts`) |
| what a run remembered | `ExecutionResult.memory`, replayed with `applyMemory` |
| what a widget shows | `NodeResult.display` |
| the order to generate a graph in | `topologicalLevels` |

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
   lists every write in `result.memory`. Then each page node is asked what it shows,
   *with* those values.
5. **Watching and stopping.** `RunBoard` (`host/runs.ts`) starts a run in the background,
   turns the executor's progress events into the `RunSnapshot` the page polls, and aborts
   it on Stop. An `AbortSignal` reaches every model call and every sandboxed body.

`executeNode` (one node on given inputs) and `inputsFor` (run what feeds a node, not the
node) are the same machinery, and are what the editor's **Try it** panel uses.

## Authoring: one loop for every element

Every element that has a body — an AI node's prompt, a code node, a chart's transform, a
file selector — is written the same way, in `authoring/AuthoredBodyEditor` +
`authoring/TryItPanel`:

```
what it should do ──✨──▶ body ──▶ Try it: [values] ⟳ from the graph · ▶ Test ──▶ what came out
                            ▲                │
                            └── verified ────┘   the same values are the sample ✨ is
                                                 written and checked against (tryValues.ts)
```

Generation (`host/editor/generate.ts`) is: write → run once on the sample → ask the
element's `check` → repair once with the evidence. Every model call is recorded (`AICall`)
and can be watched while it runs; the result waits for the person to accept it.

## Where state lives

| State | Lives in | Travels as |
|---|---|---|
| the graph | `graph.json` (+ optional `<graph>.nodes/*.js|md`) | the document |
| a widget's value, a conversation, a data node's value | inside the graph, in the element's own config | `result.memory` → `applyMemory` |
| a run in flight | `RunBoard` on the server | `RunSnapshot`, polled |
| the last run | the editor's store / the served page / `schedule.ts` | `ExecutionResult` |
| keys, endpoints, MCP servers that start programs | `ai-settings.json`, machine-side, never in a graph | — |
| which model writes code for you | the browser (`store/settingsStore.ts`) | request fields (`ModelChoice`) |

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
- Panels are typed (`NodePanelProps`, `WidgetPanelProps`), not `any`: a shell that stops
  handing a panel what it reads fails to compile.
- Things that were settable and did nothing are removed rather than documented.

## Known debt

- **`NodeConfig` is one type for six node kinds** (`editor/src/graph.ts`), and
  `baseNodeConfig()` gives every new node every field, so a saved graph carries keys its
  node never reads. Harmless to the engine (elements pick what they know), noisy in diffs.
  The fix is per-element `create()` defaults plus a config type per element; it touches
  every panel, which is why it has not been done in passing.
- **Partial runs re-run upstream nodes** rather than reusing their last outputs. Correct,
  and cheap for readers and pages; a cache keyed on inputs would be the next step.
- **No server-side persistence of scheduled results** beyond the process's lifetime, and no
  ingest endpoint: a scheduled tool is a clock around a run, not a monitoring system.
