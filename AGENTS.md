# Agent Navigation Guide

This file tells an AI coding agent — especially a cheap/fast model (`Cheap-Coder` /
`Cheap-Debugger`) given a narrow, single-file task — exactly where to look for a given
kind of change, so it doesn't need to read the whole codebase.

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
touching or re-running assertions for unrelated elements.

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
time.** `text_input`/`file_input`/`directory_input` become `input` (with the matching
`config.input_mode` and `prompt_at_runtime=True`, since legacy inputs always prompted);
`text_output` becomes `output` with `write_mode="window"`; widget kinds
`file_open`/`directory_open` become `input_picker` (mode `file`/`directory`) and
`text_window`/`chat_window` become `text_io` (mode `both`). This happens once in
`Graph._migrate_legacy_nodes` (see "One-time legacy migrations" below) and is mirrored
client-side in `graphStore.ts` (`migrateLegacyNode`) for raw JSON imports that bypass
the backend. No element branches on an alias anymore. File
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

Use `elements/gui/widgets/input_picker/input_picker_element.py` and
`elements/gui/widgets/input_picker/inputPickerElement.ts` as the exact pattern to copy
for any other widget kind.

Registry: `backend/app/elements/registry.py` (`GUI_WIDGET_ELEMENTS`) on the backend, and
`frontend/src/elements/registry.ts` (`GUI_WIDGET_ELEMENTS`, whose `RuntimeWidget` field is
what `GuiWindow.tsx` renders) on the frontend.

A canonical widget kind therefore has **two** element files (one per language), plus one
registry line per language. Its frontend definition references the local config editor
and runtime widget; shared shells dispatch through the registry and need no kind switch.

## GUI runtime window & designer (not per-widget-kind)  

- `frontend/src/components/gui/GuiWindow.tsx` — the floating runtime window shown per `gui` node; lays widgets out and feeds each one its live value.
- `frontend/src/components/gui/GuiWindowLayer.tsx` — mounts one window per `gui` node.
- `frontend/src/components/gui/GuiDesigner.tsx` — grid layout designer writing `x`/`y`/`w`/`h` onto widgets.
- `frontend/src/components/gui/layout.ts` — pure grid-resolution helper (fallback to list order); unit-tested in `layout.test.ts`.
- `frontend/src/components/gui/widgetProps.ts` — the shared `{ widget, value, onChange }` contract every runtime widget implements.

## Memory-feedback edges (data/gui/widget nodes)
A `data`, `gui`, or `widget` node is a **memory element**: its output can reflect its own
persisted state rather than being freshly recomputed from inputs each round. This is
what lets a `gui -> ai -> gui` graph run at all despite being a cycle at node level — an
edge feeding one of a memory node's input ports is automatically excluded from cycle
detection and topological ordering, exactly when needed to break a cycle, with no manual
edge marking required (no `deferred`/`initial_value` fields exist on `GraphEdge` — they
were removed because the old design required threading a `previous_outputs` parameter
across separate `execute_graph()` calls that no real caller, `routers/execute.py` or
`graph-runner/run.py`, ever actually did — the feature only worked in tests that
manually simulated a second round).

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
this logic never needs a second implementation for deploy. It is never per-node-type: no
`elements/<type>/<type>_element.py` should know about it.

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

## Where the AI configuration lives (two different questions)

There are two AI choices in this system and they deliberately live in different
places. Do not merge them, and do not add a third copy of either:

| Question | Lives in | Set once in |
|---|---|---|
| Which AI **writes** my code/prompts? | `frontend/src/store/settingsStore.ts` (localStorage), server fallback `AI_GRAPH_GEN_PROVIDER`/`AI_GRAPH_GEN_MODEL` | ⚙ Settings in the editor toolbar |
| Which AI does the graph **call when it runs**? | `metadata.ai_defaults` in the graph DSL | ⚙ Settings, and overridable at run time |

The generation AI is a property of the workstation, not of the graph: it never
affects execution, it is the same for every node, and a graph shared with a
colleague should not carry someone's model choice. It used to be
`NodeConfig.gen_ai_provider`/`gen_ai_model` plus a per-widget copy on
`GuiWidget`; those fields are gone (old graphs load fine -- pydantic's default
`extra="ignore"` drops them). Every ✨ Generate call spreads `genAI()` from the
settings store into its request body, so there is exactly one place in the
frontend that decides which AI generates, and `routers/ai.py`'s `_gen_target`
is the one place on the backend that fills in a missing choice.

The runtime AI is resolved in exactly one place too:
`app/services/ai_settings.py`, called from `ai_service.complete()`. An `ai`
node's `ai_provider` defaults to `AIProvider.DEFAULT` ("follow the run"); a node
that names a real provider keeps it. Precedence, highest first:

1. a run-level override -- `--ai-provider`/`--ai-model` (CLI, `serve.py`), or
   the deployed GUI's settings panel
2. `AI_GRAPH_AI_PROVIDER` / `AI_GRAPH_AI_MODEL`
3. `ai-settings.json` (cwd, next to the executable, `$AI_GRAPH_SETTINGS`, or
   `~/.ai-graph/settings.json`) -- which also carries endpoints and API keys, so
   a double-clicked executable is configurable with no environment variables
4. the graph's own `metadata.ai_defaults`, published by `execute_graph()`
5. `ollama` / `llama3`

`--ai-force` (or `AI_GRAPH_AI_FORCE=1`, or `"force": true` in the settings file)
also overrides nodes that pin their own provider.

`ai_settings.py` is vendored into every bundle, so editor, CLI and deployed tool
resolve the AI identically. An element never participates in this: `AIElement`
passes its node's configured pair to `complete()` and knows nothing else, and
`graph_executor` publishes the graph default because an element never sees the
graph it lives in.

## The deploy bundle's three entry points

Every script a bundle ships is a repo file copied verbatim -- the same rule that
keeps the engine from drifting, applied to the runner:

| Bundle file | Repo file | When it ships |
|---|---|---|
| `main.py` | `graph-runner/run.py` | always -- the CLI |
| `serve.py` | `graph-runner/serve.py` | when the graph has an interactive node **and** `frontend/dist/runtime.html` exists |
| `build_exe.py` | `graph-runner/build_exe.py` | always -- PyInstaller one-file build |

`build_exe.py` turns a bundle into a single executable that needs no Python on
the target machine; `main.py`'s `_default_graph_path()` is what makes the
embedded `graph.json` findable there (and lets one dropped beside the executable
win, so a shipped tool can be re-pointed at an edited graph without a rebuild).

**GUI runtime.** A `gui`/`widget` node's `deploy_needs` sets
`interactive_ui=True`; `deploy_service._serves_gui` combines that with the
presence of a built frontend. When both hold, the bundle also gets `static/`
(the built `frontend/dist`, as bytes -- the bundle dict is
`Dict[str, str | bytes]`) and `fastapi`/`uvicorn` in `requirements.txt`.
`serve.py` serves `runtime.html`, which mounts
`frontend/src/runtime/RuntimeApp.tsx`: the editor's own graph store and
`GuiWindowLayer`, with the canvas removed. **There is no second widget
implementation** -- a deployed tool renders through the exact components the
designer previewed, which is the whole reason this is a web runtime and not a
native one. `serve.py` defines its handful of endpoints inline rather than
vendoring `app/routers/*`: a deployed tool must not offer code generation or
file browsing. Without a built frontend the graph still deploys, headless, and
the generated README says why.

## Deploying a graph — vendored-runtime bundles, not codegen

`deploy_service.py` does **not** generate source code from each node's config. A deploy
bundle is the real engine, copied verbatim, plus the user's graph:
`generate_deployment_bundle(graph)` returns a `{path: contents}` dict containing
`app/elements/**` (every element file, recursively), `app/models/graph.py`,
`app/services/{ai_service,batching,code_executor,file_service,graph_executor}.py`, the
graph itself as `graph.json`, a `main.py` that is a **verbatim copy of
`graph-runner/run.py`** (that script's own docstring documents it as dual-purpose: dev
CLI *and* bundle entry point), plus `requirements.txt`/`Dockerfile`/`docker-compose.yml`/
`README.md`. `app/routers/*`, `app/main.py` (FastAPI-only) and `deploy_service.py` itself
(a server-only build tool) are deliberately NOT vendored — confirmed by
`test_deploy_runner_execution.py::test_deploy_bundle_layout`. Because execution logic is
shipped rather than regenerated, a bundle's behavior can never drift from the live
editor's; `test_deploy_runner_execution.py` proves this by writing a real bundle to disk
and running its `main.py` as a subprocess, then diffing its output against
`execute_graph()`'s.

## Cross-cutting services (not per-node-type — read these when a task spans node types)

- `backend/app/services/graph_executor.py` — topological execution, batching, input/format resolution; delegates per-node work to `elements.registry.NODE_ELEMENTS[node.node_type].execute(...)`.
- `backend/app/services/deploy_service.py` — assembles the vendored-runtime deploy bundle described above (which files to copy, `requirements.txt`/Dockerfile generation); does not generate per-node code.
- `backend/app/services/batching.py` — the shared batch-merge/reconcile helpers described above.
- `backend/app/services/ai_service.py`, `code_executor.py`, `file_service.py` — provider-agnostic AI calls, sandboxed code execution, file I/O helpers shared across node types.
- `frontend/src/components/NodeEditor.tsx` — modal shell (tabs/save-cancel/AI-generate handlers), dispatches to the per-node-type `ConfigEditor`s above.
- `frontend/src/components/GuiWidgetEditor.tsx` — widget list/add/remove/reorder, dispatches to the per-kind `ConfigEditor`s above.
- `frontend/src/store/graphStore.ts` — Zustand graph state (nodes/edges, load/save, port sync).

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
