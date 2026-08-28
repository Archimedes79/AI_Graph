# Agent Navigation Guide

This file tells an AI coding agent — especially a cheap/fast model (`Cheap-Coder` /
`Cheap-Debugger`) given a narrow, single-file task — exactly where to look for a given
kind of change, so it doesn't need to read the whole codebase. For what AI-Graph is and
how to run/use it, see [README.md](README.md).

## Golden rule

If your task is scoped to **one node type** or **one GUI widget kind**, you almost
certainly only need to touch **one class in one file per table row below** (plus, if
behavior changes, a matching workflow-level test). Do not open or edit files belonging
to other node types/widget kinds — that's how a big refactor stays safe for a cheap
model to work on in small pieces.

## Cost-bounded single-element workflow

To keep an edit round cheap: name the exact file(s) from the tables below, make the
change, run ONLY that element's slice of the consolidated contract test (never the
full suite) while iterating, and run the full suite exactly once before rollout.

```powershell
# backend, scoped to one node type or widget kind (id = the enum's .value)
cd backend; .venv\Scripts\python.exe -m pytest tests/test_element_contract.py -k <node_type_or_widget_kind> -q -x

# frontend, scoped to one node type or widget kind
cd frontend; npm run test -- -t "node element: <node_type>"
cd frontend; npm run test -- -t "gui widget element: <widget_kind>"

# only before rollout/commit: full suite once
cd backend; .venv\Scripts\python.exe -m pytest tests -q
cd frontend; npm run test
```

Do not run the full suite (or ask an agent to) on every edit round — the consolidated
tests in `test_element_contract.py` / `elementContract.test.ts` are parametrized per
node type/widget kind precisely so a single-element change can be verified without
touching or re-running assertions for unrelated elements. `python checkpoint.py` runs
both full suites plus the build/package steps in the right order before a release —
see [README.md](README.md#-quick-start).

## Object-oriented element contract

Every `NodeType` and `GuiWidgetKind` is one **element**: a class owning ALL of its
live-execution behavior (and for widgets its ports) in one file, rather than the same
behavior scattered across separate executor files. Base classes live in
`backend/app/elements/base.py`:

- `NodeElement` — one per `NodeType`. Implements `async execute(node, inputs,
  effective_formats=None) -> dict` (live execution — this is the ONLY behavior an
  element implements; there is no separate deploy-codegen method, see "Deploying a
  graph" below). Also implements `runtime_requirements(node)` (what interactive input
  the live editor/CLI must prompt for before running — defaults to a no-op on the base
  class) and `deploy_needs(node) -> DeployNeeds` (what this node changes about the
  deployed bundle: `httpx` for AI calls, the web runtime for an interactive node —
  merge-able via `DeployNeeds.__or__`). `DeployNeeds` carries **only** needs that
  actually change the bundle; fields for "reads files" and "runs code" existed,
  were computed by six elements, and were read by nobody, because those services
  are stdlib-only and vendored unconditionally. Stateless singleton; all
  node-specific data comes from the `GraphNode` argument, never `self`.
- `GuiWidgetElement` — one per `GuiWidgetKind`, the `gui` node's sub-elements. Implements
  `ports(widget) -> (inputs, outputs)`, `execute(widget, inputs) -> Any`, and the
  widget-level equivalents `runtime_requirement(widget)` / `deploy_needs(widget)`.

`graph_executor.py`'s `get_runtime_requirements` and `deploy_service.py`'s
`requirements.txt` generation both dispatch through these methods now — neither should
branch on `node.node_type`/`widget.kind` directly; add a new override on the element
instead.

The `gui` node's own `NodeElement` (`elements/gui/gui_element.py`, `GuiElement`) is a
**Composite**: it owns no widget behavior itself, it only looks up each of its
`config.gui_widgets` in `elements.registry.GUI_WIDGET_ELEMENTS` and dispatches to that
widget's `execute`, merging their results. This is the "gui master element" that
contains one-or-more sub-elements and synchronizes them — the object hierarchy where the
lowest level (a widget) again supports the same execute contract as a top-level graph
element.

**Legacy names no longer exist as enum members — they are migrated away at load
time.** See "One-time legacy migrations" below for the exact mapping. File
operations live once in `app.services.file_service`
(`resolve_path`/`list_directory`/`read_text_file`/`write_formatted_file` etc. — call
these, don't reimplement `Path(x).expanduser().resolve()` inline). The deployed bundle
doesn't hand-copy a second version of this logic either: `deploy_service.py` vendors
`file_service.py`/`batching.py`/`code_executor.py`/`ai_service.py` (and every element
file) into the bundle **verbatim** (see "Deploying a graph" below) — there is exactly
one authored copy of each behavior, and the bundle just ships the real module. The same
applies to batching: `app.services.batching.reconcile_outputs` / `batch_inputs` /
`merge_batch_outputs` are the portable core that both `graph_executor.py` and the
vendored bundle's copy of `graph_executor.py` share, because it's the same file. If you
need "resolve/list/read a file" or "batch/merge/reconcile" behavior anywhere new, add it
to `file_service.py` / `batching.py` — it is automatically picked up by every deploy
bundle generated afterward.
`app.elements.base.widget_input_or_value(widget, inputs)` is the equivalent shared helper
for a picker's "incoming wired value, falling back to its stored value" idiom;
`TextIOElement` owns its distinct input/output/both precedence locally.

On the frontend, `frontend/src/elements/types.ts` defines the equivalent (React has no
useful class story here, so these are plain objects, not classes):

- `NodeElementDefinition` — `ConfigEditor` (the node's config-panel component, "draw +
  interact + save/load") and `create(id) -> GraphNode` (the node's starting state when
  dragged onto the canvas — "interact with the user" at creation time).
- `GuiWidgetElementDefinition` — `ports(widget)`, `ConfigEditor`, and `RuntimeWidget`
  (what actually draws in the floating `GuiWindow` and lets the user interact with it).

Each frontend element's files live together in one folder, e.g.
`frontend/src/elements/code/codeElement.ts` + `frontend/src/elements/code/CodeEditor.tsx`
(same for every node type and gui widget kind) — the editor component is no longer in a
separate `components/nodes/editors/`/`components/widgets/editors/` tree. Shared editors
used by more than one element (`MergeSplitEditor.tsx`, `OutputFormatEditor.tsx`) live in
`frontend/src/elements/shared/` instead of under any single element's folder.

**What an element needs to know about its neighbors, and no more:** a `NodeElement`
never inspects other nodes, edges, or topology — `graph_executor.py` resolves all of
that first (topological order, batching, format decoding) and hands the element only
its own already-resolved `inputs` dict. A `GuiWidgetElement` never knows it lives inside
a `gui` node beyond the `{widget.id}_in` / `{widget.id}_out` port naming convention. This
is intentional: it's what lets a cheap agent implement one element correctly by reading
only that one file plus its reference sibling, never the engine.

**Scope boundary (deliberate, not an oversight):** `NodeConfig` / `GuiWidget` stay one
shared, flat Pydantic/TS schema across all node types and widget kinds (see "Shared
contracts" below) rather than a per-type schema class — splitting that is a much larger,
DSL-breaking change and is out of scope for the element refactor.

## Adding/changing a node type's behavior

| Node type | Backend element (execute) | Frontend element (config panel + defaults) |
|---|---|---|
| `input` | `backend/app/elements/input/input_element.py` | `frontend/src/elements/input/inputElement.ts` + `InputEditor.tsx` (same folder) |
| `ai` | `.../elements/ai/ai_element.py` | `.../elements/ai/aiElement.ts` + `AIEditor.tsx` |
| `code` | `.../elements/code/code_element.py` **(reference)** | `.../elements/code/codeElement.ts` + `CodeEditor.tsx` **(reference)** |
| `data` | `.../elements/data/data_element.py` | `.../elements/data/dataElement.ts` + `DataEditor.tsx` |
| `output` | `.../elements/output/output_element.py` | `.../elements/output/outputElement.ts` + `OutputEditor.tsx` |
| `gui` | `.../elements/gui/gui_element.py` **(Composite, see above)** | `.../elements/gui/guiElement.ts` + `GuiEditor.tsx` (wraps `components/GuiWidgetEditor.tsx`) |

There is no `widget` node type any more: it was a `gui` node holding exactly one
widget, served by the same element class registered twice, and is migrated to `gui`
at load time. The palette's single-widget entries still exist — they build a `gui`
node with one widget in it.

Use `elements/code/code_element.py` and `elements/code/codeElement.ts` as the exact pattern to
copy for any other node type — same class shape, same method names, same import style.

Registry — only touch this if you're **adding a brand-new node type**, not changing an
existing one: `backend/app/elements/registry.py` and `frontend/src/elements/registry.ts`
(`NODE_ELEMENTS`). `NodeEditor.tsx`, `Sidebar.tsx`, and `graphStore.ts` resolve behavior
through the frontend registry; do not add a new per-type switch to those shared shells.

## Adding/changing a GUI widget kind

| Widget kind | Backend element (ports + execute) | Frontend element (ports + config panel + runtime widget) |
|---|---|---|
| `input_picker` | `backend/app/elements/gui/widgets/input_picker/input_picker_element.py` **(reference)** | `frontend/src/elements/gui/widgets/input_picker/inputPickerElement.ts` + `InputPickerEditor.tsx` **(reference)** |
| `text_io` | `.../gui/widgets/text_io/text_io_element.py` | `.../elements/gui/widgets/text_io/textIoElement.ts` + `TextIoEditor.tsx` |
| `plot_window` | `.../gui/widgets/plot_window/plot_window_element.py` (display-only, no output port) | `.../elements/gui/widgets/plot_window/plotWindowElement.ts` + `PlotWindowEditor.tsx` |
| `image_view` | `.../gui/widgets/image_view/image_view_element.py` (display-only; overrides `display_value`) | `.../elements/gui/widgets/image_view/imageViewElement.ts` + `ImageViewEditor.tsx` |

`plot_window`'s transform snippet runs through the same sandboxed `code_executor` as a
Code node and is rendered by the dependency-free inline SVG `frontend/src/components/PlotWidget.tsx`
(user-facing contract: see [README.md](README.md#-gui-nodes)).

Use `elements/gui/widgets/input_picker/input_picker_element.py` and
`elements/gui/widgets/input_picker/inputPickerElement.ts` as the exact pattern to copy
for any other widget kind.

Registry: `backend/app/elements/registry.py` (`GUI_WIDGET_ELEMENTS`) on the backend, and
`frontend/src/elements/registry.ts` (`GUI_WIDGET_ELEMENTS`, whose `RuntimeWidget` field is
what `GuiWindow.tsx` renders) on the frontend.

A canonical widget kind therefore has **two** element files (one per language), plus one
registry line per language. Its frontend definition references the local config editor
and runtime widget; shared shells dispatch through the registry and need no kind switch.

## Dropping a graph file

`App.tsx` listens for `dragover`/`drop` on the **window**, not on the canvas. A file
dropped a few pixels outside the canvas would otherwise be opened by the *browser*,
navigating away and taking the unsaved graph with it. The handler ignores anything that
is not a real file, so `GraphCanvas`'s palette drop is untouched, and it goes through the
same `parseGraphJson` + `confirmDiscard` every other load path uses — a drop must not
become the one route that destroys unsaved work silently. The loaded graph has no
`currentFilePath`: a browser never reveals where a dropped file lives (same reason the
pickers browse server-side, below).

## File and directory pickers browse the SERVER

`<input type="file">` cannot be used to fill any path field in this app. A browser
deliberately never reveals a chosen file's location — only its name — while the engine
resolves real absolute paths on the machine it runs on. A native picker therefore
produced a bare filename that failed later as a file-not-found from whatever the working
directory happened to be.

One component does this: `frontend/src/components/FileBrowserDialog.tsx`, backed by
`POST /api/files/browse` → `file_service.browse_directory`. Its three call sites are
`GraphWindows.tsx` (the before-running prompt), the `input_picker` runtime widget, and
`InputEditor.tsx` (a node's default path). Wire new path fields to it rather than adding
a file input.

`graph-runner/serve.py` serves the same route so a deployed tool's picker works too, but
**only on a loopback bind** (`_is_loopback`): on `--host 0.0.0.0` it would expose the
host's filesystem listing to the network, which is a different thing from letting the
person at the keyboard choose their own file. A deployed tool still exposes no code
generation and no graph editing.

## GUI runtime window & designer (not per-widget-kind)  

- `frontend/src/components/gui/GuiWindow.tsx` — the floating runtime window shown per `gui` node; lays widgets out and feeds each one its live value.
- `frontend/src/components/gui/GuiWindowLayer.tsx` — mounts one window per `gui` node.
- `frontend/src/components/gui/GuiDesigner.tsx` — grid layout designer writing `x`/`y`/`w`/`h` onto widgets.
- `frontend/src/components/gui/layout.ts` — pure grid-resolution helper (fallback to list order); unit-tested in `layout.test.ts`.
- `frontend/src/components/gui/widgetProps.ts` — the shared `{ widget, value, onChange }` contract every runtime widget implements.

## Memory-feedback edges (data/gui/widget nodes)

Why this exists and how it looks in a graph (`gui → ai → gui`): see
[README.md](README.md#cyclic-graphs-gui--ai--gui). The rest of this section is the
implementation, which is agent-relevant because it's never per-node-type: no
`elements/<type>/<type>_element.py` should know about it.

Logic lives in exactly one backend place — `graph_executor.py`:
`_is_memory_node`, `_memory_feedback_edge_ids` (Kahn's algorithm, marking one
memory-targeting edge as feedback at a time until the graph is acyclic; used by
`_topological_sort`/`_topological_levels`/`_collect_inputs`/`_blocked_required_port`),
and `_settle_memory_feedback` — a same-round pass that runs after all topological
levels finish executing, writing each feedback edge's fresh source value directly into
the target data node's `config.data_value` or widget's persisted `value` (read by the
*next* round's output) and into that round's own `NodeResult.inputs` (so the frontend, which already prioritizes
`nodeResult.inputs[widget_id + "_in"]` for display in `GuiWindow.tsx`, shows the fresh
value immediately, same round). A deploy bundle vendors `graph_executor.py` verbatim, so
this logic never needs a second implementation for deploy.

No `deferred`/`initial_value` fields exist on `GraphEdge` — they were removed because
the old design required threading a `previous_outputs` parameter across separate
`execute_graph()` calls that no real caller (`routers/execute.py` or
`graph-runner/run.py`) ever actually did — the feature only worked in tests that
manually simulated a second round.

`frontend/src/store/graphStore.ts` mirrors the same cycle-detection algorithm
(`memoryFeedbackEdgeIds`) purely to know, after receiving an `ExecutionResult`, which
edges' delivered values to persist into the target data node's `config.data_value` or
widget's own `config.gui_widgets[...].value` client-side. Successful acyclic data-node
outputs are persisted too. This is what makes memory progress across separate "Run"
clicks in the editor, since each API call is otherwise stateless.

## One-time legacy migrations

No legacy alias survives as an enum member. `Graph._migrate_legacy_nodes` (a
`model_validator(mode="before")` on `Graph` in `backend/app/models/graph.py`) rewrites
every raw node dict before enum validation:

- `merge`/`split` → an equivalent `code` node (literal Python generated from the old
  `merge_mode`/`separator` config via `_generate_merge_code`/`_generate_split_code`).
- `text_input`/`file_input`/`directory_input` → `input` with `config.input_mode` set to
  `text`/`file`/`directory` and `prompt_at_runtime=True` (legacy inputs always prompted).
- `text_output` → `output` with `write_mode="window"`.
- widget kinds `file_open`/`directory_open` → `input_picker` (mode `file`/`directory`);
  `text_window`/`chat_window` → `text_io` (mode `both`).

This runs once, at load time, for every `Graph.model_validate`/`model_validate_json`
call (including FastAPI request bodies); afterward the node/widget is ordinary and the
legacy strings are never valid enum values again. `graphStore.ts`'s
`migrateLegacyNode` mirrors the alias rules client-side for raw JSON imports that never
touch the backend. When deleting a node type/widget kind, extend this one-time-rewrite
pattern — do not add a permanent branch to a surviving element.

## Shared frontend building blocks (use these, don't re-author them)

Each of these replaced a pattern that had been hand-written between 7 and 33
times, and in every case the copies had already drifted. Reach for them before
writing a new dialog, generate button, or style object:

| Need | Use | Not |
|---|---|---|
| A modal/overlay | `components/Modal.tsx` | a hand-rolled backdrop + panel + header |
| A ✨ Generate button's state | `elements/shared/useGenerate.ts` | your own `generating`/`message` pair |
| A message for a failed request | `utils/errorText.ts` | `e?.response?.data?.detail ?? …` |
| Chrome colours and control styles | `ui/theme.ts` | a hex literal in a `style={{}}` |
| Running a graph | `graphStore.runGraph(graph)` | your own execute/collect-windows loop |

`Modal` also owns the keyboard and focus behaviour (Escape, focus trap, focus
restore, `aria-modal`) that no dialog had before, which is the main reason not
to hand-roll one: a new bespoke overlay silently loses all of it.

`ui/theme.ts` holds only chrome that repeats. A colour used once -- a node
type's tint, a chart accent -- stays where it is used; adding it here would
make the file a dumping ground rather than a vocabulary.

Two contracts worth knowing before touching a GUI widget:

- **`GuiWidgetRuntimeProps` has both `value` and `incoming`.** `value` is what
  the widget itself holds and what its `{id}_out` port emits; `incoming` is what
  arrived on `{id}_in`. They were one prop, which is what made a chat window
  overwrite the reply the user was reading as they typed. Display-only widgets
  can still just take `incoming ?? value`.
- **`components/gui/layout.ts` owns all grid maths**, including `sizeToGrid`
  (re-exported from `utils/guiWidgets.ts`). There used to be a second size→cells
  table here that disagreed with it on three of six numbers.

## Shared contracts — coordinate before editing

These define the DSL every table above depends on. Changing them affects every node
type/widget kind at once, so they should be edited deliberately by the orchestrating
agent, not as part of a single-node-type task:

- `backend/app/models/graph.py` — `NodeType`, `GuiWidgetKind`, `GraphNode`/`GuiWidget`/`Port`/`GraphEdge` Pydantic models, `sync_gui_node_ports`.
- `frontend/src/types/graph.ts` — the mirrored TypeScript types.

Batching is also shared, and lives in `backend/app/services/batching.py`
(`reconcile_outputs`, `batch_inputs`, `merge_batch_outputs`) so both `graph_executor.py`
and any element's `execute` can import it without a circular-import trick. Since a
deploy bundle vendors `batching.py` verbatim (see below), there is no second copy of
this behavior that could drift from the editor's.

## A project is a graph plus one file per authored node

`backend/app/services/node_files.py` owns the format; **one mechanism, not one per
node type**. Every element turns out to have the same shape -- one authored body and
one prompt that produced it -- so each declares it once and nothing in the service or
the router branches on `node_type`:

| Element | `authored_file()` returns | File |
|---|---|---|
| `code` | `code` from `code_prompt` | `.py` / `.js`, header in `#` / `//` comments |
| `ai` | `system_prompt` from `description` | `.md`, header as YAML front matter |
| `data` | `data_format_prompt` from `data_prompt` | `.md` |
| `input`, `output` | `None` — nothing authored | none |

A new node type gets files by returning an `AuthoredFile` from its element. The
extension follows the content: real code gets `.py` and a language server with it,
prose gets `.md`, because prose in a `.py` is a syntax error — a field that becomes a
schema declaration is one word of change there. The frontend mirrors this with
`NodeElementDefinition.authoredFile`, which is what decides whether NodeEditor offers
the option at all.

**The file is authoritative for what a person authors.** `routers/graph.py` reads it
into the element's body field on `/file/load` and writes it on `/file/save`, so the
engine is untouched — the body field is still what executes and nothing downstream
knows files exist. That one router is the whole sync boundary.

Which header keys flow back is deliberately narrow:

| Key | |
|---|---|
| body, `node`, `prompt`, `context-file` | **authored** — the file wins, applied on load |
| `id` | the key matching file to node; never applied |
| `inputs`, `outputs` | derived from the wiring; regenerated on write, ignored on read — a text file renaming a port would silently break edges |

The file name follows the node's **label**, so the file tree reads like the graph;
saving renames the file when the label changes and resolves collisions with a numeric
suffix. Fences are matched by shape rather than an exact dash count, and a file with no
recognisable header is treated as all body, so one can be written by hand.

**Two editors, one file.** Every read and write records the file's mtime and size;
a write that would land on a file changed since then raises `FileChangedError` and the
save returns 409 rather than overwriting. `POST /graphs/file/reload-nodes` takes the
outside changes and clears the conflict — otherwise the editor would be stuck. The
tracking is in-memory and per-process on purpose: this is a local tool, and a
stat-based guard that forgets on restart is honest about what it can promise.

Deploy is unaffected: the editor holds the body field resolved, and a bundle is built
from the graph the browser sends.

## What the AI knows when it generates

`frontend/src/elements/shared/generationContext.ts` is the one place that answers
"what does the model see besides the user's sentence". Every ✨ Generate button joins:

1. **Port names** — `inputs`/`outputs` go with a code request, and the backend's system
   prompt tells the model the returned dict's keys must match them exactly.
2. **`connectedFormatContext`** — the declared contract of every directly wired
   neighbour, for *all* node types (it once covered `data` nodes only, so the commonest
   wiring of all, an input feeding a code node, contributed nothing). Deduplicated: two
   ports into one neighbour are two edges but one fact.
3. **`lastRunContext`** — the values the node actually received on the last run, from
   `executionResult` in the store. Run once, then generate, and the model works from real
   data instead of a description of it. Truncated per port; empty before the first run.
4. **A context file** — the 📎 attachment, read server-side by `routers/ai.py`'s
   `_with_context_file`, which appends the content plus a parsed preview of up to 8
   records so the model can see the shape rather than infer it.

When adding a Generate button, compose these rather than inventing a fifth context
string; a prompt that exists twice is a prompt that will drift.

## Where the AI configuration lives (two different questions)

There are two AI choices in this system and they deliberately live in different
places — what each one does, where to set it in the UI, and the runtime-AI override
precedence are documented for users in
[README.md](README.md#choosing-the-ai-once-not-per-node). This section is only the
implementation pointers; do not merge the two choices, and do not add a third copy of
either:

| Question | Lives in | Resolved by |
|---|---|---|
| Which AI **writes** my code/prompts? | `frontend/src/store/settingsStore.ts` (localStorage), server fallback `AI_GRAPH_GEN_PROVIDER`/`AI_GRAPH_GEN_MODEL` | Every ✨ Generate call spreads `genAI()` from the settings store into its request body; `routers/ai.py`'s `_gen_target` fills in a missing choice server-side. |
| Which AI does the graph **call when it runs**? | `metadata.ai_defaults` in the graph DSL | `app/services/ai_settings.py`, called from `ai_service.complete()`, applying the precedence order documented in the README. |

It used to be `NodeConfig.gen_ai_provider`/`gen_ai_model` plus a per-widget copy on
`GuiWidget`; those fields are gone (old graphs load fine — pydantic's default
`extra="ignore"` drops them).

`ai_settings.py` is vendored into every bundle, so editor, CLI and deployed tool
resolve the AI identically. An element never participates in this: `AIElement`
passes its node's configured pair to `complete()` and knows nothing else, and
`graph_executor` publishes the graph default because an element never sees the
graph it lives in.

## Deploying a graph — vendored-runtime bundles, not codegen

`deploy_service.py` does **not** generate source code from each node's config — see
[README.md](README.md#-deployment) for how a user triggers and runs a bundle. A bundle
is the real engine, copied verbatim, plus the user's graph:
`generate_deployment_bundle(graph)` returns a `{path: contents}` dict containing
`app/elements/**` (every element file, recursively), `app/models/graph.py`,
`app/services/{ai_service,batching,code_executor,file_service,graph_executor}.py`, the
graph itself as `graph.json`, plus `requirements.txt`/`Dockerfile`/`docker-compose.yml`/
`README.md`. `app/routers/*`, `app/main.py` (FastAPI-only) and `deploy_service.py` itself
(a server-only build tool) are deliberately NOT vendored — confirmed by
`test_deploy_runner_execution.py::test_deploy_bundle_layout`.

Every script a bundle ships is a repo file copied verbatim — the same rule applied to
the runner as to the engine:

| Bundle file | Repo file | When it ships |
|---|---|---|
| `main.py` | `graph-runner/run.py` (dual-purpose: dev CLI *and* bundle entry point) | always |
| `serve.py` | `graph-runner/serve.py` | when the graph has an interactive node **and** `frontend/dist/runtime.html` exists |
| `build_exe.py` | `graph-runner/build_exe.py` | always — PyInstaller one-file build |

`build_exe.py` turns a bundle into a single executable that needs no Python on
the target machine; `main.py`'s `_default_graph_path()` is what makes the
embedded `graph.json` findable there (and lets one dropped beside the executable
win, so a shipped tool can be re-pointed at an edited graph without a rebuild).

**GUI runtime.** A `gui`/`widget` node's `deploy_needs` sets `interactive_ui=True`;
`deploy_service._serves_gui` combines that with the presence of a built frontend. When
both hold, the bundle also gets `static/` (the built `frontend/dist`, as bytes — the
bundle dict is `Dict[str, str | bytes]`) and `fastapi`/`uvicorn` in `requirements.txt`.
`serve.py` serves `runtime.html`, which mounts `frontend/src/runtime/RuntimeApp.tsx`:
the editor's own graph store and `GuiWindowLayer`, with the canvas removed. **There is
no second widget implementation** — a deployed tool renders through the exact
components the designer previewed, which is the whole reason this is a web runtime and
not a native one. `serve.py` defines its handful of endpoints inline rather than
vendoring `app/routers/*`: a deployed tool must not offer code generation or file
browsing. Without a built frontend the graph still deploys, headless, and the generated
README says why.

Because execution logic is shipped rather than regenerated, a bundle's behavior can
never drift from the live editor's; `test_deploy_runner_execution.py` proves this by
writing a real bundle to disk, running its `main.py` as a subprocess, and diffing its
output against `execute_graph()`'s.

## Frozen builds (PyInstaller) — four places that must stay frozen-aware

`build_editor_exe.py` packages the editor itself into one executable (user-facing
docs: [README.md](README.md#option-4--standalone-executable)); `graph-runner/build_exe.py`
does the same for a deploy bundle. A frozen build breaks two assumptions that hold
everywhere else — **the repo layout is gone** (everything ships under `sys._MEIPASS`)
and **`sys.executable` is the tool, not a Python**. Four places encode that, and a
change to any of them needs a rebuilt exe to verify, not just a green test suite:

| File | What it resolves when frozen | Breaks if wrong |
|---|---|---|
| `app/main.py` | `frontend/dist` under `sys._MEIPASS` | the exe serves no UI |
| `app/services/deploy_service.py` | `_APP_ROOT`/`_REPO_ROOT` under `sys._MEIPASS` | 🚀 Deploy fails — it reads `.py` files as text to vendor them, so the exe must ship `app/` and `graph-runner/` as **data**, not just as importable modules |
| `app/services/code_executor.py` | a real `python` on PATH, probed (`_python_interpreter`) | Python code nodes relaunch the editor instead of running |
| `app/services/file_service.py` | attachments dir next to the executable | uploads land in a temp dir deleted on exit |

`app/main.py` registers `GET /` **only when no frontend is mounted**: an explicit route
always wins over a `StaticFiles` mount, so claiming it unconditionally would serve JSON
at the editor's own entry point.

`_python_interpreter()` probes each candidate by running it, because Windows ships a
`python.exe` App Execution Alias that `shutil.which` returns happily and that only
advertises the Microsoft Store. `_run_in_subprocess` decodes subprocess output with
`errors="replace"` for the same reason: that stub's failure message is in the OS
locale's encoding, and a decode error would mask the real cause.

**Verifying a change here needs `smoke_test_exe.py`, not the test suites** — they
import the modules directly and never see `sys.frozen`. It starts a built executable
and drives it over HTTP; `.github/workflows/release.yml` runs it against the downloaded
artifact in both modes. When stopping the executable, note that a `--onefile` build is a
bootloader whose real server is a *child* process: terminating what you launched leaves
the server holding its port and its inherited stdout, which hangs a CI job rather than
failing it. `_terminate_tree` exists for that.

## Cross-cutting services (not per-node-type — read these when a task spans node types)

- `backend/app/services/graph_executor.py` — topological execution, batching, input/format resolution; delegates per-node work to `elements.registry.NODE_ELEMENTS[node.node_type].execute(...)`.
- `backend/app/services/deploy_service.py` — assembles the vendored-runtime deploy bundle described above (which files to copy, `requirements.txt`/Dockerfile generation); does not generate per-node code.
- `backend/app/services/batching.py` — the shared batch-merge/reconcile helpers described above.
- **Batch execution** (`_execute_batch_node` in `graph_executor.py`) runs `per_item` items
  concurrently, bounded by `config.batch_concurrency` (0 = `AI_GRAPH_BATCH_CONCURRENCY`,
  itself 4). A failed item contributes `None` on every output port rather than aborting
  the batch, and the node reports `ExecutionStatus.PARTIAL` — which counts as *delivering*,
  so downstream nodes still run. Anything that reads `outputs` after checking for
  `success` must accept `partial` too; the frontend has one helper, `utils/executionStatus.ts`.
- **Display-only widgets** get a last hook before their value reaches the UI:
  `GuiWidgetElement.display_value(widget, value)`, called by the `gui` composite after the
  optional transform snippet. `image_view` uses it to turn a server-side path into a
  `data:` URL. Put kind-specific display preparation there, never a branch in
  `gui_element.py`.
- `backend/app/services/ai_service.py`, `code_executor.py`, `file_service.py` — provider-agnostic AI calls, sandboxed code execution, file I/O helpers shared across node types.
  **Vision** lives in three message builders there (`_openai_user_content`,
  `_anthropic_user_content`, `_ollama_images`): four providers share the OpenAI
  content-parts format, so adding it was one function rather than one per provider.
  `ai_element` passes `images=` only when there are any, so a text-only request is
  exactly the call it always made. The path→data-URL conversion is
  `file_service.image_data_url`, shared with the `image_view` widget — an element must
  never import another element's module.
- `backend/app/services/code_env.py` — the one environment code nodes run in, and the
  interpreter resolution that used to live in `code_executor`. A node declares packages in
  `config.requirements`; `deploy_service` writes them into a bundle's requirements.txt and
  `code_executor` checks them before running. **Nothing installs implicitly** — that is an
  explicit action (the editor's Install button, `main.py --install-requirements`), because
  it needs the network and can take minutes. Vendored into bundles.
- `backend/app/services/run_registry.py` — runs started as asyncio tasks so they can be
  watched and stopped. **Cancellation is ordinary task cancellation**, which is why
  `graph_executor`'s per-node `except Exception` must never widen to `BaseException`, and
  why `code_executor._run_in_subprocess` holds its `Popen`: `asyncio.to_thread` cannot be
  interrupted, so without that kill a stopped run frees the UI while the child keeps
  running. Vendored into deploy bundles, so a deployed tool has Stop too.
- `frontend/src/components/NodeEditor.tsx` — modal shell (tabs/save-cancel/AI-generate handlers), dispatches to the per-node-type `ConfigEditor`s above.
- `frontend/src/components/GuiWidgetEditor.tsx` — widget list/add/remove/reorder, dispatches to the per-kind `ConfigEditor`s above.
- `frontend/src/store/graphStore.ts` — Zustand graph state (nodes/edges, load/save, port sync)
  and the undo history. **A new mutating action must call `get().commit()` first**, which
  snapshots the state *before* the change; committing an identical state twice is a no-op,
  so a delete arriving through both the node's button and ReactFlow's `remove` change still
  costs one Ctrl+Z. Do NOT commit from `setRFNodes`/`setRFEdges` — a drag routes a position
  change through them on every frame, so drag history comes from `onNodeDragStart` in
  `GraphCanvas.tsx` instead. Undo restores through `applyGraphSnapshot`, which shares
  `buildReactFlowGraph` with `loadGraph` and deliberately leaves `savedSnapshot` alone, so
  undoing back to the last saved state reads as clean again.

## Tests

Prefer **large, workflow-level tests** — a realistic multi-node graph run through
`execute_graph`, or a real vendored deploy bundle actually executed as a subprocess —
over one test file per node type/executor. Splitting tests that finely fragments the
suite without making it more effective. See `backend/tests/test_graph.py`,
`test_gui_node.py`, `test_directory_to_code_forwarding.py`, and
`test_deploy_runner_execution.py` for the existing pattern before adding a new test file.

Adding a new `NodeType`/`GuiWidgetKind` or changing an existing element's behavior?
Extend the **consolidated element-contract tests** instead of writing a new per-element
test file: `backend/tests/test_element_contract.py` walks every registered element and
asserts add/remove, execute, save/load round-trip, and AI wiring (where applicable);
`frontend/src/elements/elementContract.test.ts` walks the same registries for
`create`/`ports`/`ConfigEditor`/`RuntimeWidget` sanity.
