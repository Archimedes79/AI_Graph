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
  class) and `deploy_needs(node) -> DeployNeeds` (which optional runtime dependency,
  e.g. `httpx` for AI calls, the deployed bundle's `requirements.txt` needs — also
  merge-able via `DeployNeeds.__or__`). Stateless singleton; all node-specific data
  comes from the `GraphNode` argument, never `self`.
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

## Memory-feedback edges (gui/widget nodes)
A `gui`/`widget` node is a **memory element**: its output reflects its own persisted
`GuiWidget.value` rather than being freshly recomputed from inputs each round. This is
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
the target widget's persisted `value` (read by the *next* round's output) and into that
round's own `NodeResult.inputs` (so the frontend, which already prioritizes
`nodeResult.inputs[widget_id + "_in"]` for display in `GuiWindow.tsx`, shows the fresh
value immediately, same round). A deploy bundle vendors `graph_executor.py` verbatim, so
this logic never needs a second implementation for deploy. It is never per-node-type: no
`elements/<type>/<type>_element.py` should know about it.

`frontend/src/store/graphStore.ts` mirrors the same cycle-detection algorithm
(`memoryFeedbackEdgeIds`) purely to know, after receiving an `ExecutionResult`, which
edges' delivered values to persist into the target widget's own `config.gui_widgets[...].value`
client-side — this is what makes the loop actually progress across separate "Run" clicks
in the editor, since each API call is otherwise stateless.

A more general **memory element** — one that can read and write data within the *same*
cycle, like a register update, rather than relying on the gui/widget-only automatic
exclusion above — is a planned future addition, not yet implemented.

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
