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
engine/src/elements/                            editor/src/elements/
  ElementRunner.ts                                ElementGuiBuilder.ts
  NodeRunner.ts                                   NodeGuiBuilder.ts
  WidgetRunner.ts                                 WidgetGuiBuilder.ts
  registry.ts                                     registry.ts
  Runtime.ts  port.ts  folderListing.ts           fields/  (settings several panels share)
  nodes/                                          nodes/
    ai/     AiNodeRunner.ts  prompt.ts              ai/   AiNodeGuiBuilder.ts  AiNodePanel.tsx
                                                          AiNodeAdvancedPanel.tsx  PromptPreview.tsx
    code/   CodeNodeRunner.ts                       code/ CodeNodeGuiBuilder.ts  CodeNodePanel.tsx …
    data/ gui/ input/ output/                       data/ gui/ input/ output/
  widgets/                                        widgets/
    roster.ts                                       roster.ts
    StaticWidgetRunner.ts                           StaticWidgetGuiBuilder.ts
    DisplayWidgetRunner.ts                          DisplayWidgetGuiBuilder.ts
                                                    DisplayWidgetPanel.tsx
    select/ SelectWidgetRunner.ts                   select/ SelectWidgetGuiBuilder.ts
                                                            SelectWidgetView.tsx
                                                            SelectWidgetPanel.tsx
    plot_window/ PlotWindowWidgetRunner.ts          plot_window/ PlotWindowWidgetGuiBuilder.ts
                 view.ts                                        PlotWindowWidgetView.tsx
                                                                PlotChart.tsx
    …                                               …  WidgetView.ts
```

**Names follow the file format, mechanically, and pair across the wire.** Every element
class in the engine ends in `Runner`; its editor half is a class that swaps `Runner` for
`GuiBuilder`, and inherits the same way. Node type `ai` is `AiNodeRunner` in
`nodes/ai/AiNodeRunner.ts` and `AiNodeGuiBuilder` in `nodes/ai/AiNodeGuiBuilder.ts`;
widget kind `plot_window` is `PlotWindowWidgetRunner` and `PlotWindowWidgetGuiBuilder`.
One class per file, and the file is named after it.

**What the two words mean.** Two axes cross in them, and together they are the whole
reason the split exists.

- `Runner` against `GuiBuilder` is **what the class is for**: running the application, or
  building it. A graph is an application; it runs with no browser anywhere.
- `Gui` in the middle is **where the class lives**: the engine owns the graph and runs it,
  and everything a person clicks is in the browser, which the engine never imports.

So a `Runner` is the application, and a `GuiBuilder` is the tooling around it. That is why
only one of the two may be missing from a delivered tool, and why it is the builder:
a deployed graph runs, and nobody edits it. The fourth square of the grid — build-time work
in the engine, such as `generation()` — has no class of its own; it rides on the `Runner`
under a `── Build time` bar, which [`times.test.ts`](../engine/src/elements/times.test.ts)
reads and enforces.

| Engine | Editor |
|---|---|
| `ElementRunner` | `ElementGuiBuilder` |
| `NodeRunner` | `NodeGuiBuilder` |
| `WidgetRunner` | `WidgetGuiBuilder` |
| `StaticWidgetRunner`, `DisplayWidgetRunner` | `StaticWidgetGuiBuilder`, `DisplayWidgetGuiBuilder` |
| `AiNodeRunner` | `AiNodeGuiBuilder` |
| `SelectWidgetRunner` | `SelectWidgetGuiBuilder` |

Each element has a fixed set of **facets**, told apart by suffix:

| Facet | Engine (Node) | Editor (browser) |
|---|---|---|
| What it is and does: config, ports, `execute`, `generation` | `<Kind>NodeRunner.ts` / `<Kind>WidgetRunner.ts` | — |
| How it looks on a page — the designer and the deployed tool draw the same component | — | `<Kind>WidgetView.tsx`, listed in `page/blocks.ts` |
| Its settings | — | `<Kind>NodePanel.tsx` / `<Kind>WidgetPanel.tsx` |
| What the editor's shells ask of it | — | `<Kind>NodeGuiBuilder.ts` / `<Kind>WidgetGuiBuilder.ts` |

A node's look on the canvas is generic (`canvas/GraphNodeView.tsx`), so nodes have no view
of their own. [`symmetry.test.ts`](../editor/src/elements/symmetry.test.ts) holds the two
sides to this: both registries list the same kinds, and every element has its files, under
its names, on both sides.

## The element hierarchy

Behaviour lives in classes. Shared code asks the element and never switches on a type name.

```
ElementRunner<Subject, Config>          config() · texts() · logic() · catchesErrors() ┊ generation() · deployNeeds()
├── NodeRunner<C>                a node: derivedPorts · execute · display · eventPorts · keepsTime · settleMemory ┊ whatRuns · problems · graphAuthorNote
│   ├── InputNodeRunner   AiNodeRunner   CodeNodeRunner
│   ├── DataNodeRunner    OutputNodeRunner   SubgraphNodeRunner
│   ├── TriggerNodeRunner        an event with nobody there: the tool starting, a clock
│   └── GuiNodeRunner            a composite: holds widgets, its ports are theirs
└── WidgetRunner<C>              a widget: ports · execute · firesRun · settle · displayValue ┊ receives · graphAuthorNote
    ├── InputPickerWidgetRunner   TextIoWidgetRunner   SelectWidgetRunner
    ├── SliderWidgetRunner        ButtonWidgetRunner   ChatWidgetRunner
    ├── StaticWidgetRunner       no ports: part of the page, not the graph
    │   └── TextWidgetRunner   DividerWidgetRunner   SpacerWidgetRunner
    └── DisplayWidgetRunner      one input, nothing out: shows what arrives, says what it draws
        └── PlotWindowWidgetRunner   TableWidgetRunner   ImageViewWidgetRunner

ElementGuiBuilder<Subject, PanelProps>           Panel · generation
├── NodeGuiBuilder                        label · icon · color · hint · AdvancedPanel · describeOutput/canvasSummary · resultPreviews   (builder only)
│                                         + the four steps' declarations: stepped · exampleInput · ownsDescription
│                                           portEditing/portHint · wantsOn · restingValue/restingFile · publishedDescription
│   ├── InputNodeGuiBuilder   AiNodeGuiBuilder   CodeNodeGuiBuilder
│   ├── DataNodeGuiBuilder    OutputNodeGuiBuilder   SubgraphNodeGuiBuilder   TriggerNodeGuiBuilder
│   └── GuiNodeGuiBuilder
└── WidgetGuiBuilder                      create(label, mode) · label · paletteEntries · defaultSpan · defaultTone · runOnChangeHint · InlineEditor · preview   (builder only)
    ├── InputPickerWidgetGuiBuilder   TextIoWidgetGuiBuilder   SelectWidgetGuiBuilder
    ├── SliderWidgetGuiBuilder        ButtonWidgetGuiBuilder   ChatWidgetGuiBuilder
    ├── StaticWidgetGuiBuilder            starts unnamed: page furniture has no ports to name
    │   └── TextWidgetGuiBuilder   DividerWidgetGuiBuilder   SpacerWidgetGuiBuilder
    └── DisplayWidgetGuiBuilder           one panel: what the kind shows, in its runner's words
        └── PlotWindowWidgetGuiBuilder   TableWidgetGuiBuilder   ImageViewWidgetGuiBuilder
```

The browser half is the same tree with `GuiBuilder` for `Runner`, and
[`symmetry.test.ts`](../editor/src/elements/symmetry.test.ts) compares the two lineages
class by class. What each kind knows about its own appearance — its name, icon and colour,
a new widget's size, tone and first values, how its last result reads on the canvas — is a
member of its `GuiBuilder`, not a table in a shell. After a run the canvas shows each value a
node made under the port it stands at, read by its shape (`elements/resultPreview.ts`: a
line, a count and the first row, a sketch, a thumbnail); `NodeGuiBuilder.resultPreviews` says
which port, and where the element reads a value its own way it says so — a page shows what
each block shows, and a chart block reads a list of points as a chart
(`WidgetGuiBuilder.preview`). An element is handed its services (`Runtime.ts`: `files`,
`code`, `ai`, `tools`) rather than reaching for them.

### Build time and run time, in one class

There are three programs in this repository: the **editor** (building a graph), the
**page of a tool** (using one), and the **run** (what happens between a press and an
answer). A tool needs the last two. What it does not need, it must never *call* — and that
is the line that is kept, not "never carry".

An element is one class per kind, and it holds both what a run asks of it and what only
building asks. Two classes per kind (or four, with the browser half) were considered and
turned down: the knowledge is small, it belongs to the kind, and one file per kind is what
makes a kind easy to add. So on the **engine** side build-time members travel into a
bundle with their class, and are kept apart *inside* it instead. (On the browser side it
turned out there was nothing to keep apart — see below.)

- Every base class (`ElementRunner`, `NodeRunner`, `WidgetRunner`; `NodeGuiBuilder`, `WidgetGuiBuilder`) is
  laid out under three bars — **What it is · Run time · Build time** — and every kind keeps
  that order, its build-time members under a `── Build time` bar of its own.
- The bars are load-bearing: `elements/times.test.ts` reads them, on both sides.

| | What it is | Run time | Build time |
|---|---|---|---|
| **asked by** | anything that reads a graph | the executor, a served tool | the editor, `check`, `test`, a bundle being made, a project being saved |
| `ElementRunner` | `config` · `texts` · `logic` | `catchesErrors` | `generation` · `deployNeeds` |
| `NodeRunner` | `nodeType` · `derivedPorts` · `nestedGraph` · `blocks` · `isResult` · `resultLabel` · `boundaryRole` · `valuePorts` · `keepsOutputInterface` · `outputInterface` | `execute` · `display` · `eventPorts` · `keepsTime` · `isMemory` · `settleMemory` · `fansOut` · `batchMode` · `readsFileInputs` · `needsInput` · `runtimeRequirements` · `applyRuntimeValue` | `whatRuns` · `problems` · `graphAuthorNote` · `asksModel` · `referencedPaths` |
| `WidgetRunner` | `widgetKind` · `ports` | `execute` · `firesRun` · `settle` · `displayValue` | `receives` · `graphAuthorNote` |
| `NodeGuiBuilder` | `nodeType` | — | **everything**: the palette, panels, what ✨ Generate is told |
| `WidgetGuiBuilder` | `widgetKind` | — | **everything**: the palette, its panel |

### …and a third role, which is neither

The two `GuiBuilder` rows have no run-time members left, and that is the point: **a `GuiBuilder` is the
builder, whole, and a delivered tool never loads it.**

What used to sit on their run-time side was never really the builder's — it was a third
role that had nowhere to live:

| Was | Is now | Because |
|---|---|---|
| `WidgetGuiBuilder.View`, `ownsValue` | [`page/blocks.ts`](../editor/src/page/blocks.ts) | what the **page draws** — the one part of a widget a recipient operates |
| `NodeGuiBuilder.create`, `settings`, `saved` | [`document/nodeKinds.ts`](../editor/src/document/nodeKinds.ts) | what a node **is** — filled in on every load, stripped on every save, which a delivered tool does as much as the editor |
| `NodeGuiBuilder.showsResultWindow` | — | gone with the output node's window: a run's result is what its output nodes hand back, under their labels |
| `WidgetGuiBuilder.clearValueAfterRun` | `WidgetRunner.clearsValueAfterRun` | what a **run** means for a block, the same family as `settle` |

A node's middle role is empty by nature: the canvas is never delivered. A widget's is not,
because the page is. `nodeKinds.ts` belongs in the engine beside `NodeRunner.config`; what
keeps it in the editor for now is `NodeConfig`, the one spelled-out settings shape, and
moving that is a step of its own.

This is why the editor's `times.test.ts` can hold that a `GuiBuilder`'s run-time bar is
**empty**, and why [`runtime/boundary.test.ts`](../editor/src/runtime/boundary.test.ts) can
hold, with no exception for the shared store, that no `GuiBuilder` class and neither element
registry is even *reachable* from the tool's entry point. Before
that, the store was the one module both hosts share and the one allowed to reach into the
builder, so the builder was in every bundle. Measured on the import graph: what
`runtime/main.tsx` reaches fell from 80 modules to 45.

Still reachable, and not closed by any of this: the **engine's** element tree, for a
handful of questions the page asks it — which ports, does this block fire, does this node
carry the interface. That goes when the graph arrives already resolved over the wire.

What the tests hold: every member stands under a bar; the build-time list is spelled out,
so moving a member across is a decision and not a bar that slipped; **no file a run goes
through** (`execution/`, `elements/body.ts`, `host/serve.ts`, `runs.ts`, `schedule.ts`,
`node.ts`) **mentions a build-time member**; and nothing a tool's page can reach asks a
`GuiBuilder` for anything at all. What is *not* carried at all stays as it was:
`host/editor/` never enters a bundle, and a panel is a lazy chunk a tool never fetches.

**What runs.** `NodeRunner.whatRuns(node)` answers the question a node's folder could not:
which code runs when this node runs. Either a body in the folder (`code.js`, a changed
`run.js`), run sandboxed — or this kind's `execute`, named by file, with one sentence
saying what it does. The same answer is shown at the foot of its panel and listed in
[graphs.md](graphs.md#what-runs-and-where); a test
checks that the file and the method it names exist.

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
  errors.ts          NotFound · NotAGraph  document/           what a graph is to the editor: nodeKinds,
                                             guiWidgets (a page's ports), layout (the grid),
                                             wires (a canvas wire as the saved edge)
  elements/          see above             elements/           see above
  authoring/         how a body is         authoring/          writing a body in four steps: ✨ Generate,
    generation.ts    written, where it       FourSteps           Try it, the live transcript, the
    logic.ts         is kept, who runs it    NodeSteps …         page-wide sweep (graphSweep.ts)
  execution/         running a graph       canvas/             the graph on screen: GraphCanvas,
    executor.ts      order · run · settle    GraphNodeView       GraphNodeView, NodeEditor, ResultPreview
    triggers.ts      what starts a run     page/               the graph's one page: GuiPage (drawn by
    batching.ts  fileInputs.ts               GuiPage             the editor and the tool alike), the
    runtimeValues.ts  images.ts              DesignerTab …       Page tab, the Preview tab, layout, schemes
    reuse.ts  interface.ts  examples.ts
  project/           a graph on disk
    folder.ts        read · write · watch
    flow.ts          flow.json: nodes and wires
    interfaceFile.ts a node's ports
    check.ts         what is wrong
  host/              Node and HTTP         api/client.ts       the contract's client
    api.ts           the contract          app/                toolbar, sidebar, dialogs, results
    serve.ts  http.ts  runs.ts             store/              the open graph, runs, undo
    schedule.ts  node.ts                   runtime/            the deployed tool's page
    lifecycle.ts     what is stopped, in order
    editor/          never bundled         ui/                 look: theme, tone, colour scheme, Modal
                                           dialogs/            FileBrowserDialog, PathField, RequirementsDialog
  ai/                providers · MCP · settings
  cli/               cli.ts  bundle.ts
```

Within `editor/src` an import inside one area (`canvas/`, `page/`, …) is relative; one that
crosses areas goes through `@/`, and one into the engine through `@engine/`.

**The editor has layers, and an area imports only from a lower one.** From the bottom:
`ui` (look, knowing no graph) · `graph` · `document` and `api` · `store` · `dialogs` ·
`elements` and `authoring` · `page` and `canvas` · `app` · `App` and `runtime` · `main`.
[`layers.test.ts`](../editor/src/layers.test.ts) reads the imports and fails on one that goes
up, or sideways between two areas of one rank. The single sideways pair is
`elements` ↔ `authoring`, on purpose: a panel is made of authoring editors, and an authoring
editor asks the registry what a node is. Panels are lazy chunks, so there is no static cycle.

## Five rules

**1. An element owns everything about its kind.** Its settings (`config()`), its ports,
what it does (`execute`), what it shows (`display`), how an AI writes its body
(`generation()`), and what a good result looks like (`Generation.check`) — in its own
class. Adding a kind adds one folder on each side and one line in each registry
(`elements/registry.ts` and `widgets/roster.ts` in the engine, `elements/registry.ts` in
the editor), and nothing else changes.

**2. The executor owns everything about a run.** Ordering, fan-out over lists, reading
the file on each input that says so, catching failures, stopping, idle-skipping, settling memory, and asking for
displays are done once, in `execution/executor.ts`, for every element alike. An element
declares (`fansOut` and `batchMode`, `readsFileInputs`, `catchesErrors`, `needsInput`, `isMemory`,
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
feature that needs a compiler: no enums, no parameter properties). What the tests share
sits beside `src`, not in it — `engine/test/fakes.ts` (a runtime with no world attached),
`editor/test/engineAnswers.ts` (what a run asks a node's element) — so no bundle, package
or layer rule has to be told to leave it out.

**5. One implementation, replayed — never two that agree.** Where one side needs what the
other knows, it imports it or replays its result:

| The browser needs | It gets it from |
|---|---|
| every route, request and response | `host/api.ts` |
| the graph's types | `graph.ts` |
| a page node's ports | `GuiNodeRunner.derivedPorts` via `document/guiWidgets.ts` |
| whether a widget starts the graph | `WidgetRunner.firesRun` |
| the request an AI node will send | `assemblePrompt` (`elements/nodes/ai/prompt.ts`) |
| what a run remembered | `ExecutionResult.memory`, replayed with `applyMemory` |
| what a widget shows | `NodeResult.display` |
| the order to generate a graph in | `topologicalLevels` |

## A run

1. **Order.** Kahn's algorithm gives levels. A loop through a node that remembers (a page,
   a data node) is legal: edges that close a loop into memory nodes are left out of the
   ordering (`memoryFeedbackEdges`, never by the order the wires are stored in) and settled
   after the round, port by port.
2. **What runs.** Everything — or, for an event (a block on a page, a trigger node), the
   nodes its port is wired to, what follows from them, and what those need upstream,
   including what computes a ◆ among them the event does not open itself (`triggers.ts`). An event is a boolean that is true for the round it started
   (`Runtime.fired`, asked of `NodeRunner.eventPorts`); a run no event started counts every
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
   input came up empty → read the file on each input typed `file_path` (a code or AI node's
   "Read the file at this path"; never guessed from the wire) → run once, or once per item → record.
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
node) are the same machinery, and are what the editor's **Try it** and **⟳ From the
graph** use.

## Authoring: one loop for every node that writes

Every node that has a body — an AI node's prompt, a code node — is written the same way,
in four steps (`authoring/FourSteps`, drawn by `NodeSteps`). A block on a page has none: a
chart, a table or an image shows what arrives, a folder picker lists its folder, and what
reshapes a value or chooses some of the files is a code node wired in before or after it.
The block's dialog is its settings, and for a display block one sentence of what it shows
(`DisplayWidgetRunner.draws`, the same words the node wired into it is told). Nor do the
nodes that are values: an input is a text or a folder's listing, a data node its kind and
what it holds, an output the run's result under its label (and a file or folder of it, if
asked) — their dialogs are those settings, and a file is read nowhere but at the input of
the node that wants its text.

```
1 what comes in:  ports ("read the file at this path") + ONE example   ⟳ · 📂 · a file dropped · "run once per item"
2 what comes out: ports, where each goes and what it wants (read only) + ONE words field + kept shape
3 what it should do ──✨──▶ 4 body ──▶ ▶ Try it ──▶ what came out · ✓/✗ expected · judge · "and 2 more"
                             ▲                        │  Keep as expected output
                             └── "Say what to change" ┘  ✨ Fix (where it failed)
```

The example is one thing, kept once: the first section of the node's `examples.md`
(`authoring/examplePair.ts`). It is the sample ✨ is written and
checked against (`nodeFacts`), what Try it runs, what an AI node's request is shown for,
and what `test` runs. Where the file holds a judge's sentence or more examples, Try it runs
them the way `test` does (`testNode`), so the answer shown is the answer judged.

An AI node and a code node have the same sections in the same order and the same buttons;
only the body differs. Where an element keeps a result differently, its panel hands that to
`NodeSteps` rather than `NodeSteps` asking what it draws: an AI node's answer is never the
same twice, so its "Keep as expected output" writes "Answer in this shape: …" into its words
(`keep`, with `elements/nodes/ai/keptAnswer.ts`); a code node's writes the example's expect
block. Each panel says what its words in step 2 are for (`wordsHint`).

**No Save.** What a node's dialog changes is written into the graph a moment later
(`canvas/nodeDialog.ts`), one undo step per field typed into (`graphStore.commit`'s
coalescing); Undo takes it back, and closing the dialog loses nothing. What cannot be stored
yet -- an example that is not an object, a port name that is empty or taken -- stays in its
field with the reason (`useTyped`), and is never written.

**Changing what there is.** "Say what to change" and ✨ Fix go through the one generate path
with `refine`: the body as it is, what came of it (the try on screen, else the last run) and
the words -- none for a fix, which is the repair step made of the body there is. The answer
brings the task back restated, and the dialog writes both as one step and tries it at once.

**One way to run a body — on Node.** A code node's `code.js` and an ai node's or a
subgraph node's changed `run.js` are one kind of thing, and `elements/body.ts` (`runBody`)
is the only place in the engine that runs one: `async function run(inputs, node)`, in a
process of its own, returning an object keyed by output port. The element decides *when*;
what a failure costs is the executor's (`catch_errors`); never *how*. The probe that tries
generated code on a sample runs it the same way, so code that asks a model is tried with a
node it can ask. Nothing runs in the page: a node says *what* to plot (`{kind, title,
points}`, ordinary data on a wire, or finished SVG), and the chart draws it at the block's
real size (`plot_window/PlotChart.tsx`), redrawn on a resize with no run.

**A body can ask.** `CodeService.run(body, inputs, signal, context)` hands a body a second
argument, `node`: plain data, and `calls` — questions it may put to the process that holds
the graph, over its own stdin/stdout (`host/node.ts`). That is how a body asks a model
without ever holding a key: `node.llm` is answered by `askModel` (`nodes/ai/ask.ts`), the one
way to ask, counted per run -- and offered to every body, since they all run the one way. An ai node's `run.js` (`nodes/ai/runTemplate.ts`) is such a
body; left as the engine shipped it, the engine makes its one call directly.

Generation (`host/editor/generate.ts`) is: write → run once on the sample → hold it to the
keys it must return and to what the example expects → repair once with the evidence. The
sample is what came off the wires,
so for a node that reads its file inputs the files are read first, by the function a run
reads them with (`execution/fileInputs.ts`) — code tried on a filename finds no rows,
returns an empty chart, and passes. A node that runs once per item is probed on one item,
cut from the sample by the rule the executor cuts by (`batchItems`), and its answer is
recorded as the list a run hands on (`mergeBatchOutputs`), so the shape kept from a probe is
the shape a run checks itself against. Every model call is recorded
(`AICall`) and can be watched while it runs; the result is written into the node at once,
and Undo takes it back.

## A graph on disk

A graph is a folder, and **each fact is in one place**:

- `flow.json` — which nodes there are (`id → type`) and every wire, one line each:
  `"page.file_out -> chart.csv"` ([`project/flow.ts`](../engine/src/project/flow.ts)). Nothing
  about any node.
- `nodes/<id>/node.json` — the node's name and settings. `nodes/<id>/interface.json` — its
  ports, and the output shape a run kept ([`project/interfaceFile.ts`](../engine/src/project/interfaceFile.ts)).
  Nothing about its neighbours: a node that needs to know what arrives follows the wire and
  reads the other node's interface. Whether a node keeps an output shape is
  `NodeRunner.keepsOutputInterface`.
- Every piece of writing is a file of its own beside them — `code.js`, `system.md`. Which
  fields become which files is element knowledge, so each element declares it
  (`ElementRunner.texts`). A page's blocks write nothing: they are settings, in its
  `node.json`.
- `layout.json` — positions only.

[`project/folder.ts`](../engine/src/project/folder.ts) reads and writes a folder for everyone —
editor, CLI, a served tool, the MCP server — and never learns what a code node is. The graph
in memory is the same document it always was; only the folder is laid out this way.
`graphFrom` puts it together from the files' contents without touching a disk, so a test
or a page that has them can do the same.

- **The file wins over the inline value.** A text is read from its file when there is one.
  That is why a deploy bundle (one `graph.json` carrying everything inline) and a plain
  `.json` file open the same way. A folder is a project only when it has a `flow.json`.
- **Structure and writing never share a file**, and keys are sorted, so an unchanged
  save changes nothing and a moved node changes only `layout.json`.
- **Two editors, one folder.** Every file read or written is remembered by signature; a
  save that would overwrite a file changed since refuses (`FileChanged`) -- `flow.json` and
  `layout.json` too, so a node another writer added is not saved away -- and the editor
  asks every 1.5 s what changed (`changesOnDisk`) and takes it in as one undo step. A save
  tidies away only files it read or wrote itself that no node claims any more; a file it
  never saw is a person's, and a node of an unknown type keeps its folder.
- **Interfaces come from runs.** A code or AI node's output shape (in its `interface.json`;
  which nodes keep one is `NodeRunner.keepsOutputInterface`) is inferred from what
  its first successful run produced ([`execution/interface.ts`](../engine/src/execution/interface.ts)),
  checked against on every later run (a message, not a failure), and handed to the next
  node's generation. An AI node's `output.md` -- its words, an answer's shape kept there too --
  is also sent to the model.
- **Examples are tests, and the one sample.** A node's optional `examples.md`
  ([`execution/examples.ts`](../engine/src/execution/examples.ts)) is run by `test` and the
  MCP server's `test_graph`, through its one `testGraph`, at every depth of the graph; one node
  alone is run by `executor.ts`'s `runNodeAlone`, behind `run-node` and `run_node` alike. Its
  first section is the node dialog's example, which Try it runs and ✨ is written and checked
  against. `check` holds an example's inputs to the output interface of the node wired into
  that port.
- **`check`** ([`project/check.ts`](../engine/src/project/check.ts)) is the one list of
  problems: the CLI prints it and CI fails on it, the MCP server returns it before saving. It finds
  what any node can get wrong; what is wrong with *one kind* of node — a code node with no code, a
  message template asking for an input that is not there, a page with two blocks of one id — is
  that element's `problems()`. A second page is a problem: a graph has one, the first node that
  `hasInterface`, and the editor and a tool draw only that. Two output nodes sharing a label are a problem too; until it is
  fixed the run's result keeps the first under the label and the others under their ids
  (`NodeRunner.ts`'s `resultKeys`), and `check` names those keys. Ids a folder could not read
  back -- two differing only in case, a number, a "." or "->" -- are problems as well
  (`flow.ts`'s `unsavableIds`), and a save refuses them.

## Where state lives

| State | Lives in | Travels as |
|---|---|---|
| the graph | a project folder: `flow.json`, `layout.json`, `nodes/<id>/` (`node.json`, `interface.json`, writing) — or one `.json` with everything inline | the document ([`project/folder.ts`](../engine/src/project/folder.ts)) |
| a widget's value, a conversation, a data node's value | inside the graph, in the element's own config | `result.memory` → `applyMemory` |
| a run in flight | `RunBoard` on the server | `RunSnapshot`, polled |
| what every node made last, for rounds its ◆ stays shut | `Latch`, in the process holding the graph; gone at restart | `NodeResult.held` |
| the last run | the editor's store / the served page / `schedule.ts` | `ExecutionResult` |
| keys, endpoints, MCP servers that start programs | `ai-settings.json`, machine-side, never in a graph | — |
| the one AI setting: what ✨ Generate, Try it (and its judge) and every run call unless a node pins its own | `ai-settings.json`'s `ai` (or `AI_GRAPH_AI_PROVIDER`/`_MODEL`), read only by `aiSetting` in [`ai/settings.ts`](../engine/src/ai/settings.ts) | `ProviderStatus.target`, for the editor's "now: …" |
| a node's own model | the node's config (`ai_provider`, `ai_model`) | the graph |

## Security boundaries

- Everything binds to loopback; file browsing and "open in my editor" switch off otherwise.
- The server answers its own page, not every page in the browser: on loopback a request must
  name 127.0.0.1, localhost or [::1] with the server's port (no DNS rebinding); an API call
  that says where it comes from must come from the server's own origin, one the browser
  marks cross-site is refused, and a body is read only when it is sent as `application/json`
  (`foreignRequest` and `readJson` in `host/http.ts`).
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
- Build time and run time are kept apart inside each element class, and the tests read the
  bars that say which is which ([`times.test.ts`](../engine/src/elements/times.test.ts),
  [its mirror](../editor/src/elements/times.test.ts)).
- No code outside `elements/` compares a node type or a widget kind with a name, in the editor
  ([`shells.test.ts`](../editor/src/elements/shells.test.ts)) or in the engine
  ([`shells.test.ts`](../engine/src/shells.test.ts); `execution/triggers.ts` alone reads the document
  without asking). What such a comparison would decide is a member of the element's class —
  `NodeRunner.hasInterface`, `missingExample`, `NodeRunner.isResult` and `resultLabel`,
  `NodeRunner.problems`, `WidgetRunner.receives`, `blocks`, `graphAuthorNote` — so a new
  kind answers for itself. The prompt that designs a whole graph is assembled from the kinds' own
  `graphAuthorNote` -- an input node says the ports each mode derives from its own `derivedPorts`,
  and the page lists every block kind with the block's own note -- and keeps only the rules that
  span kinds; a node kind without a note (a subgraph) is not offered to the model.
- The editor's layers are held by [`layers.test.ts`](../editor/src/layers.test.ts), see above.
- What two layers both say, one file says: `errors.ts` holds `NotFound` and `NotAGraph` for the
  project folder, the directory listing and the server that turns them into a status.

## Settled debt, and what is deliberately not there

A review on 2026-09-20 measured the rules above against the source and fixed what it found: the
engine's own half of "no shell names a kind" (`check.ts`, `executor.finalOutputs`,
`project/folder.ts`), the hand-written list of node types in `graphPrompt.ts`, and the editor's
layer order, now held by `layers.test.ts`. What it left, still true:

- **A few functions and files carry too much at once.** `graphStore.ts` (~960 lines: the
  document, its normalisation, the ReactFlow adapter, run polling and undo), `App.tsx` (~600
  lines), `Toolbar.tsx` (~550 lines), `mcpServer.ts`'s `createGraphTools`, and `executor.ts`'s
  `executeGraph`. Nothing in the tests catches a mistake made splitting one of them, which is
  exactly why none has been split yet. Parts of the shell already moved out of `App.tsx` into
  `app/{Sidebar,Toolbar,ResultsPanel,SettingsDialog,ViewTabs,AICredentialsSection,SubgraphTrail}.tsx`,
  so this can be done piece by piece.
- **The engine has no typed `NodeConfig`.** `config: Record<string, unknown>` is read through an
  `as` cast at each use (~630 of them); each element's own `config()` is meant to be the one
  reader that pays that price, but nothing holds other callers to asking it first.
  `mcpServer.ts` still validates `config.gui_widgets` entries by name, on a document that has
  not been parsed yet.
- **Editor tests are thin outside the structural ones.** `app/`, `canvas/` and `page/` have
  tests only for the rules pulled out of their components (`nodeDraft`, `portIds`, `pageWrite`,
  `typedValues`, `DesignerPalette`, …); the suite has no DOM, so a component is at most drawn
  once with `renderToStaticMarkup` (`NodePanels.test.ts`), never clicked.

There are no import cycles through values, and none between the engine and the editor.

- **A saved node carries only what differs from the default.** In memory every node has the
  full `NodeConfig`, so a panel can read any field with a type. `document/baseNodeConfig.ts`
  is each key's one default -- what the engine reads a missing key as. Loading fills a missing
  key from it, and `savedNode` writes only the keys that differ from it.
  [`savedConfig.test.ts`](../editor/src/elements/savedConfig.test.ts) asks the engine's element
  the questions a run asks, for every node type and mode, and holds the lean node to the full
  one's answers.
- **A run lands only in the graph it started on.** The store counts documents: every load and
  every step into or out of a node's graph is a new one. A run or a ✨ sweep notes the count it
  started with and drops what comes back for another; New, Open and Reload wait while either
  is going. The page is edited only through `page/pageWrite.ts`, which reads the page from the
  store when an edit lands.
- **A page event reuses what it only needs.** What the event is *for* — the nodes it is
  wired to and everything after them — runs fresh; a node upstream of that, run only as
  context, hands back its last outputs when its definition and every input (files already
  read) are unchanged ([`execution/reuse.ts`](../engine/src/execution/reuse.ts)). A node with
  nothing wired in reads the outside world and always runs; a whole-graph Run reuses nothing.
- **A scheduled tool remembers its last round across restarts**, in
  `<graph>.last-run.json` beside the graph. It is still a clock around a run: no history
  and no ingest endpoint, because a monitoring system is a different product.
