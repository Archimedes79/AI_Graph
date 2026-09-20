# Architecture

How AI-Graph is put together, which rules hold it together, and what is knowingly left
untidy. Read this before changing anything structural; the code comments explain the
*why* of each file, this explains how the files relate. Diagrams with every box mapped to
its files are in [`arch/overview.md`](../arch/overview.md).

## The shape

```
engine/    runs a graph. TypeScript that Node executes by stripping types: no build, no dependencies.
editor/    the page: React + ReactFlow. Built on the engine, never the other way round.
examples/  project folders that are run, event-driven, deployed and checked by the test suite.
scripts/   dev server and packaging.
arch/      the architecture diagrams, one file.
```

One process serves everything: `node engine/src/main.ts --editor editor/dist`. The same
server serves a deployed tool, with the editor's routes simply not loaded.

## Elements first

Everything the tool can do is an **element**: a node type (input, ai, code, data, output,
gui, subgraph, trigger) or a widget kind on a page (text, picker, dropdown, chart, chat, …). The design is
organised around them, and each element is one folder, at the **same relative path on
both sides**:

```
engine/src/elements/                          editor/src/elements/
  Element.ts                                    Ui.ts
  NodeElement.ts                                NodeUi.ts
  WidgetElement.ts                              WidgetUi.ts
  registry.ts                                   registry.ts
  Runtime.ts  port.ts  fileSelection.ts         fields/  (settings several panels share)
  nodes/                                        nodes/
    ai/     AiNodeElement.ts  prompt.ts           ai/     AiNodeUi.ts  AiNodePanel.tsx
                                                          AiNodeAdvancedPanel.tsx  PromptPreview.tsx
    code/   CodeNodeElement.ts                    code/   CodeNodeUi.ts  CodeNodePanel.tsx …
    data/ gui/ input/ output/                     data/ gui/ input/ output/
  widgets/                                      widgets/
    roster.ts                                     roster.ts
    StaticWidgetElement.ts                        StaticWidgetUi.ts
    DisplayWidgetElement.ts                       DisplayWidgetUi.ts
    TransformingDisplayElement.ts                 TransformingDisplayUi.ts  TransformingDisplayPanel.tsx
    select/ SelectWidgetElement.ts                select/ SelectWidgetUi.ts  SelectWidgetView.tsx
                                                          SelectWidgetPanel.tsx
    plot_window/ PlotWindowWidgetElement.ts       plot_window/ PlotWindowWidgetUi.ts
                 check.ts  view.ts                             PlotWindowWidgetView.tsx  PlotChart.tsx
    …                                             …  WidgetView.ts
```

**Names follow the file format, mechanically, and pair across the wire.** Every element
class ends in `Element`; its editor half is a class that swaps `Element` for `Ui`, and
inherits the same way. Node type `ai` is `AiNodeElement` in `nodes/ai/AiNodeElement.ts`
and `AiNodeUi` in `nodes/ai/AiNodeUi.ts`; widget kind `plot_window` is
`PlotWindowWidgetElement` and `PlotWindowWidgetUi`. One class per file, and the file is
named after it.

| Engine | Editor |
|---|---|
| `Element` | `Ui` |
| `NodeElement` | `NodeUi` |
| `WidgetElement` | `WidgetUi` |
| `StaticWidgetElement`, `DisplayWidgetElement`, `TransformingDisplayElement` | `StaticWidgetUi`, `DisplayWidgetUi`, `TransformingDisplayUi` |
| `AiNodeElement` | `AiNodeUi` |
| `SelectWidgetElement` | `SelectWidgetUi` |

Each element has a fixed set of **facets**, told apart by suffix:

| Facet | Engine (Node) | Editor (browser) |
|---|---|---|
| What it is and does: config, ports, `execute`, `generation` | `<Kind>NodeElement.ts` / `<Kind>WidgetElement.ts` | — |
| How it looks on a page — the designer and the deployed tool draw the same component | — | `<Kind>WidgetView.tsx` |
| Its settings | — | `<Kind>NodePanel.tsx` / `<Kind>WidgetPanel.tsx` |
| What the editor's shells ask of it | — | `<Kind>NodeUi.ts` / `<Kind>WidgetUi.ts` |

A node's look on the canvas is generic (`canvas/GraphNodeView.tsx`), so nodes have no view
of their own. [`symmetry.test.ts`](../editor/src/elements/symmetry.test.ts) holds the two
sides to this: both registries list the same kinds, and every element has its files, under
its names, on both sides.

## The element hierarchy

Behaviour lives in classes. Shared code asks the element and never switches on a type name.

```
Element<Subject, Config>          config() · generation() · catchesErrors() · deployNeeds()
├── NodeElement<C>                a node: derivedPorts · execute · display · eventPorts · keepsTime · settleMemory
│   ├── InputNodeElement   AiNodeElement   CodeNodeElement
│   ├── DataNodeElement    OutputNodeElement   SubgraphNodeElement
│   ├── TriggerNodeElement        an event with nobody there: the tool starting, a clock
│   └── GuiNodeElement            a composite: holds widgets, its ports are theirs
└── WidgetElement<C>              a widget: ports · execute · firesRun · settle · displayValue
    ├── InputPickerWidgetElement   TextIoWidgetElement   SelectWidgetElement
    ├── SliderWidgetElement        ButtonWidgetElement   ChatWidgetElement
    ├── StaticWidgetElement       no ports: part of the page, not the graph
    │   └── TextWidgetElement   DividerWidgetElement   SpacerWidgetElement
    └── DisplayWidgetElement      one input, nothing out
        └── TransformingDisplayElement   an optional transform before drawing
            └── PlotWindowWidgetElement   TableWidgetElement   ImageViewWidgetElement

Ui<Subject, PanelProps>           Panel · generation
├── NodeUi                        create(id) · label · icon · color · hint · AdvancedPanel · describeOutput
│   ├── InputNodeUi   AiNodeUi   CodeNodeUi
│   ├── DataNodeUi    OutputNodeUi   SubgraphNodeUi   TriggerNodeUi
│   └── GuiNodeUi
└── WidgetUi                      create(label, mode) · label · View · defaultSpan · defaultTone · runOnChangeHint
    ├── InputPickerWidgetUi   TextIoWidgetUi   SelectWidgetUi
    ├── SliderWidgetUi        ButtonWidgetUi   ChatWidgetUi
    ├── StaticWidgetUi            starts unnamed: page furniture has no ports to name
    │   └── TextWidgetUi   DividerWidgetUi   SpacerWidgetUi
    └── DisplayWidgetUi           nothing to operate, so nothing starts the graph
        └── TransformingDisplayUi     one panel for the transform, words from each kind
            └── PlotWindowWidgetUi   TableWidgetUi   ImageViewWidgetUi
```

The browser half is the same tree with `Ui` for `Element`, and
[`symmetry.test.ts`](../editor/src/elements/symmetry.test.ts) compares the two lineages
class by class. What each kind knows about its own appearance — its name, icon and colour,
a new widget's size, tone and first values — is a member of its `Ui`, not a table in a
shell. An element is handed its services (`Runtime.ts`: `files`, `code`, `ai`, `tools`)
rather than reaching for them.

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
  execution/         running a graph       canvas/             the graph on screen: GraphCanvas,
    executor.ts      order · run · settle    GraphNodeView       GraphNodeView, NodeEditor
    triggers.ts      what starts a run     page/               a gui node's page: GuiPage (drawn by
    batching.ts  fileInputs.ts               GuiPage             the editor and the tool alike),
    runtimeValues.ts  images.ts              DesignerTab …       the designer, layout, schemes
    reuse.ts  interface.ts  examples.ts
  project/           a graph on disk
    folder.ts        read · write · watch
    check.ts         what is wrong
    legacy.ts        the old .nodes/ layout
  host/              Node and HTTP         api/client.ts       the contract's client
    api.ts           the contract          app/                toolbar, sidebar, dialogs, results
    serve.ts  http.ts  runs.ts             store/              the open graph, runs, undo
    schedule.ts  node.ts                   runtime/            the deployed tool's page
    lifecycle.ts     what is stopped, in order
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
| a page node's ports | `GuiNodeElement.derivedPorts` via `elements/nodes/gui/guiWidgets.ts` |
| whether a widget starts the graph | `WidgetElement.firesRun` |
| the request an AI node will send | `assemblePrompt` (`elements/nodes/ai/prompt.ts`) |
| what a run remembered | `ExecutionResult.memory`, replayed with `applyMemory` |
| what a widget shows | `NodeResult.display` |
| the order to generate a graph in | `topologicalLevels` |

## A run

1. **Order.** Kahn's algorithm gives levels. A loop through a node that remembers (a page,
   a data node) is legal: the fewest edges into memory nodes are left out of the ordering
   (`memoryFeedbackEdges`) and settled after the round.
2. **What runs.** Everything — or, for an event (a block on a page, a trigger node), the
   nodes its port is wired to, what follows from them, and what those need upstream
   (`triggers.ts`). An event is a boolean that is true for the round it started
   (`Runtime.fired`, asked of `NodeElement.eventPorts`); a run no event started counts every
   event as fired.
   **The ◆ (`__run`) is a gate**: wired, the node runs only when this round opens it — the
   event is wired to the node, or a node computed `true` onto it in this round; OR over
   several wires, only `true` opens. So a code node returning booleans is the filter and the
   router, and there is no node type for either. A node that stands still keeps what it made
   last (`execution/latch.ts`: meaning, not a cache — see its header for the difference from
   `reuse.ts` and from a data node); one fed only by nodes that stood still stands still
   too, unless it keeps something of its own (a page, a data node, a trigger); an event's
   `true` is never handed back by `reuse.ts`; nothing is held inside a subgraph; what stood still is never settled into memory or shown a second time.
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
   Rounds of one graph queue (`host/rounds.ts`), the clock's and the page's alike.
6. **Shutting down.** A server holds a clock, runs in flight, the children those started,
   and a socket. `serve()` writes each into a `Lifecycle` (`host/lifecycle.ts`) as it starts
   it, and `shutdown()` stops them in that order — what makes work before what carries it:
   the schedule, the runs (`RunBoard.stopAll`), then HTTP, which meanwhile still answers a
   page watching its run and refuses anything new with 503. Each step gets what is left of
   eight seconds; what would not stop is named. A scheduled round that was cut off is not
   recorded, so `<graph>.last-run.json` keeps the last round that finished. The CLI maps
   Ctrl+C, SIGTERM, SIGHUP and Ctrl+Break to it (`untilStopped`); a second signal exits at
   once. `serve()` itself installs no signal handler: it is a library function.

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

**A body can ask.** `CodeRunner.run(body, inputs, signal, context)` hands a body a second
argument, `node`: plain data, and `calls` — questions it may put to the process that holds
the graph, over its own stdin/stdout (`host/node.ts`). That is how a body asks a model
without ever holding a key: `node.llm` is answered by `askModel` (`nodes/ai/ask.ts`), the one
way to ask, counted per run. An ai node's `run.js` (`nodes/ai/runTemplate.ts`) is such a
body; left as the engine shipped it, the engine makes its one call directly.

Generation (`host/editor/generate.ts`) is: write → run once on the sample → ask the
element's `check` → repair once with the evidence. The sample is what came off the wires,
so for a node that reads its file inputs the files are read first, by the function a run
reads them with (`execution/fileInputs.ts`) — code tried on a filename finds no rows,
returns an empty chart, and passes. Every model call is recorded (`AICall`)
and can be watched while it runs; the result waits for the person to accept it.

## A graph on disk

A graph is a folder: `graph.json` holds the structure (nodes, settings, ports, edges),
`layout.json` the positions, and every piece of writing is a file of its own under
`nodes/<node id>/` — `code.js`, `system.md`, `output.schema.json`, and a block's files one
folder further down. Which fields become which files is element knowledge, so each element
declares it (`Element.texts`); [`project/folder.ts`](../engine/src/project/folder.ts) reads
and writes a folder for everyone — editor, CLI, a served tool, the MCP server — and never
learns what a code node is.

- **The file wins, `graph.json` is the fallback.** A text is read from its file when there
  is one. That single rule is why a deploy bundle (a folder whose `graph.json` carries
  everything inline) and a plain `.json` file open the same way.
- **Structure and writing never share a file**, and writing sorts its keys, so an unchanged
  save changes nothing and a moved node changes only `layout.json`.
- **Two editors, one folder.** Every file read or written is remembered by signature; a
  save that would overwrite a file changed since refuses (`FileChanged`), and the editor
  asks every 1.5 s what changed (`changesOnDisk`) and takes it in as one undo step.
- **Interfaces come from runs.** A code node's `output.schema.json` is inferred from what
  its first successful run produced ([`execution/interface.ts`](../engine/src/execution/interface.ts)),
  checked against on every later run (a message, not a failure), and handed to the next
  node's generation. An AI node's `output.md` is sent to the model instead.
- **Examples are tests, not prompts.** A node's optional `examples.md`
  ([`execution/examples.ts`](../engine/src/execution/examples.ts)) is run by `test`, the
  node dialog and the MCP server's `test_graph`; nothing generates from it. `check` holds
  an example's inputs to the output interface of the node wired into that port.
- **`check`** ([`project/check.ts`](../engine/src/project/check.ts)) is the one list of
  problems: the CLI prints it and CI fails on it, the MCP server returns it before saving.

## Where state lives

| State | Lives in | Travels as |
|---|---|---|
| the graph | a project folder: `graph.json`, `layout.json`, `nodes/<id>/<file>` — or one `.json` with everything inline | the document ([`project/folder.ts`](../engine/src/project/folder.ts)) |
| a widget's value, a conversation, a data node's value | inside the graph, in the element's own config | `result.memory` → `applyMemory` |
| a run in flight | `RunBoard` on the server | `RunSnapshot`, polled |
| what every node made last, for rounds its ◆ stays shut | `Latch`, in the process holding the graph; gone at restart | `NodeResult.held` |
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
  It never holds a key: a model call is *asked for* (`node.llm`) and made by the process
  that started it, at most 25 times each time it runs. An ai node's `run.js` from a folder somebody
  handed you is such a body too — it is never run in the trusted process.
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
- No code outside `elements/` compares a node type or a widget kind with a name
  ([`shells.test.ts`](../editor/src/elements/shells.test.ts)). What such a comparison would
  decide is a member of the element's class — `holdsWidgets`, `missingExample`,
  `describeAsSource`, `canvasSummary`, `outputFormatHint` — so a new kind answers for itself.

## Settled debt, and what is deliberately not there

- **A saved node carries its own settings only.** In memory every node has the full
  `NodeConfig`, so a panel can read any field with a type. Each `<Kind>NodeUi` names the
  `settings` it owns; `NodeUi.saved` writes those and any other key someone changed, and
  loading fills the rest back in. [`savedConfig.test.ts`](../editor/src/elements/savedConfig.test.ts)
  asks the engine's element the questions a run asks, for every node type and mode, and
  holds the lean node to the full one's answers.
- **A page event reuses what it only needs.** What the event is *for* — the nodes it is
  wired to and everything after them — runs fresh; a node upstream of that, run only as
  context, hands back its last outputs when its definition and every input (files already
  read) are unchanged ([`execution/reuse.ts`](../engine/src/execution/reuse.ts)). A node with
  nothing wired in reads the outside world and always runs; a whole-graph Run reuses nothing.
- **A scheduled tool remembers its last round across restarts**, in
  `<graph>.last-run.json` beside the graph. It is still a clock around a run: no history
  and no ingest endpoint, because a monitoring system is a different product.
