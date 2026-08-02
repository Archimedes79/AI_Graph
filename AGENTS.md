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

## Object-oriented element contract

Every `NodeType` and `GuiWidgetKind` is one **element**: a class owning ALL of its
behavior (live execution, deploy-bundle codegen, and for widgets its ports) in one file,
rather than the same behavior scattered across separate executor/compiler files. Base
classes live in `backend/app/elements/base.py`:

- `NodeElement` — one per `NodeType`. Implements `async execute(node, inputs,
  effective_formats=None) -> dict` (live execution) and `compile(node, sources,
  node_map) -> list[str]` (deploy codegen). Stateless singleton; all node-specific data
  comes from the `GraphNode` argument, never `self`.
- `GuiWidgetElement` — one per `GuiWidgetKind`, the `gui` node's sub-elements. Implements
  `ports(widget) -> (inputs, outputs)`, `execute(widget, inputs) -> Any`, and
  `compile(node, widget) -> list[str]`.

The `gui` node's own `NodeElement` (`elements/gui/gui_element.py`, `GuiElement`) is a
**Composite**: it owns no widget behavior itself, it only looks up each of its
`config.gui_widgets` in `elements.registry.GUI_WIDGET_ELEMENTS` and dispatches to that
widget's `execute`/`compile`, merging their results. This is the "gui master element"
that contains one-or-more sub-elements and synchronizes them — the object hierarchy
where the lowest level (a widget) again supports the same execute/compile contract as a
top-level graph element.

**Some concepts exist twice on purpose — reuse the shared helper, don't re-duplicate the
logic.** A handful of things are exposed both as a standalone node type and as a `gui`
widget kind (`file_input`/`file_open`, `directory_input`/`directory_open` — a file or
directory chooser either standing alone or embedded in a GUI panel). Their elements
independently call the same underlying operations, so the operations themselves live
once in a shared spot and each element just calls them:
`app.services.file_service.resolve_path`/`list_directory`/`read_text_file` (live
execution) and the `_resolve_path`/`_list_directory`/`_read_text_file` runtime helpers
embedded via `_FILE_HELPERS` in `deploy_service.py` (deploy codegen) are the shared,
already-correct implementations — a new element needing "resolve this path" or "list
this directory" should call these, not reimplement `Path(x).expanduser().resolve()`
inline. `app.elements.base.widget_input_or_value(widget, inputs)` is the equivalent
shared helper for a widget's "incoming wired value, falling back to its stored value"
idiom (used by `file_open`/`directory_open`; widgets with different fallback precedence,
e.g. `chat_window`, implement it inline instead since it's genuinely not the same rule).

On the frontend, `frontend/src/elements/types.ts` defines the equivalent (React has no
useful class story here, so these are plain objects, not classes):

- `NodeElementDefinition` — `ConfigEditor` (the node's config-panel component, "draw +
  interact + save/load") and `create(id) -> GraphNode` (the node's starting state when
  dragged onto the canvas — "interact with the user" at creation time).
- `GuiWidgetElementDefinition` — `ports(widget)`, `ConfigEditor`, and `RuntimeWidget`
  (what actually draws in the floating `GuiWindow` and lets the user interact with it).

**What an element needs to know about its neighbors, and no more:** a `NodeElement`
never inspects other nodes, edges, or topology — `graph_executor.py` /
`deploy_service.py` resolve all of that first and hand the element only its own
already-resolved `inputs` dict (plus `sources`/`node_map` at compile time purely to
generate correct variable references). A `GuiWidgetElement` never knows it lives inside
a `gui` node beyond the `{widget.id}_in` / `{widget.id}_out` port naming convention. This
is intentional: it's what lets a cheap agent implement one element correctly by reading
only that one file plus its reference sibling, never the engine.

**Scope boundary (deliberate, not an oversight):** `NodeConfig` / `GuiWidget` stay one
shared, flat Pydantic/TS schema across all node types and widget kinds (see "Shared
contracts" below) rather than a per-type schema class — splitting that is a much larger,
DSL-breaking change and is out of scope for the element refactor.

## Adding/changing a node type's behavior

| Node type | Backend element (execute + compile) | Frontend element (config panel + defaults) |
|---|---|---|
| `text_input` | `backend/app/elements/text_input/text_input_element.py` | `frontend/src/elements/text_input/textInputElement.ts` (`InputEditor.tsx`, shared) |
| `file_input` | `.../elements/file_input/file_input_element.py` | `.../elements/file_input/fileInputElement.ts` (`InputEditor.tsx`, shared) |
| `directory_input` | `.../elements/directory_input/directory_input_element.py` | `.../elements/directory_input/directoryInputElement.ts` (`InputEditor.tsx`, shared) |
| `ai` | `.../elements/ai/ai_element.py` | `.../elements/ai/aiElement.ts` (`AIEditor.tsx`) |
| `code` | `.../elements/code/code_element.py` **(reference)** | `.../elements/code/codeElement.ts` **(reference)** (`CodeEditor.tsx`) |
| `output` | `.../elements/output/output_element.py` | `.../elements/output/outputElement.ts` (`OutputEditor.tsx`) |
| `text_output` | `.../elements/text_output/text_output_element.py` | `.../elements/text_output/textOutputElement.ts` (`TextOutputEditor.tsx`) |
| `merge` / `split` | `.../elements/merge/merge_element.py` / `.../elements/split/split_element.py` | `.../elements/merge/mergeElement.ts` / `split/splitElement.ts` (`MergeSplitEditor.tsx`, shared) |
| `gui` | `.../elements/gui/gui_element.py` **(Composite, see above)** | `.../elements/gui/guiElement.ts` (`GuiEditor.tsx` wraps `GuiWidgetEditor.tsx`) |

Use `elements/code/code_element.py` and `elements/code/codeElement.ts` as the exact pattern to
copy for any other node type — same class shape, same method names, same import style.

Registry — only touch this if you're **adding a brand-new node type**, not changing an
existing one: `backend/app/elements/registry.py` (`NODE_ELEMENTS`). On the frontend
there is no single dispatch registry yet; `NodeEditor.tsx` and `Sidebar.tsx` still
switch on `node_type` directly (see "Cross-cutting services").

## Adding/changing a GUI widget kind

| Widget kind | Backend element (ports + execute + compile) | Frontend element (ports + config panel + runtime widget) |
|---|---|---|
| `file_open` | `backend/app/elements/gui/widgets/file_open/file_open_element.py` **(reference)** | `frontend/src/elements/gui/widgets/file_open/fileOpenElement.ts` **(reference)** |
| `directory_open` | `.../gui/widgets/directory_open/directory_open_element.py` | `.../elements/gui/widgets/directory_open/directoryOpenElement.ts` |
| `text_window` | `.../gui/widgets/text_window/text_window_element.py` | `.../elements/gui/widgets/text_window/textWindowElement.ts` (`TextChatEditor.tsx`, shared with `chat_window`) |
| `chat_window` | `.../gui/widgets/chat_window/chat_window_element.py` | `.../elements/gui/widgets/chat_window/chatWindowElement.ts` (`TextChatEditor.tsx`, shared with `text_window`) |
| `plot_window` | `.../gui/widgets/plot_window/plot_window_element.py` (display-only, no output port) | `.../elements/gui/widgets/plot_window/plotWindowElement.ts` |

Use `elements/gui/widgets/file_open/file_open_element.py` and
`elements/gui/widgets/file_open/fileOpenElement.ts` as the exact pattern to copy for any other
widget kind.

Registry: `backend/app/elements/registry.py` (`GUI_WIDGET_ELEMENTS`) on the backend, and
`frontend/src/elements/registry.ts` (`GUI_WIDGET_ELEMENTS`, whose `RuntimeWidget` field is
what `GuiWindow.tsx` renders) on the frontend.

A widget kind therefore has **two** files (one per language), one class each, plus one
registry line per language — adding a kind means adding those and touching nothing else.

## GUI runtime window & designer (not per-widget-kind)  

- `frontend/src/components/gui/GuiWindow.tsx` — the floating runtime window shown per `gui` node; lays widgets out and feeds each one its live value.
- `frontend/src/components/gui/GuiWindowLayer.tsx` — mounts one window per `gui` node.
- `frontend/src/components/gui/GuiDesigner.tsx` — grid layout designer writing `x`/`y`/`w`/`h` onto widgets.
- `frontend/src/components/gui/layout.ts` — pure grid-resolution helper (fallback to list order); unit-tested in `layout.test.ts`.
- `frontend/src/components/gui/widgetProps.ts` — the shared `{ widget, value, onChange }` contract every runtime widget implements.

## "t+1" (deferred) edges

`GraphEdge.deferred` marks a feedback edge carrying the **previous** round's value. It is
excluded from cycle detection and topological ordering, which is what lets a `gui -> ai ->
gui` graph run at all. Logic lives in exactly three backend places — `graph_executor.py`
(`_topological_sort`, `_topological_levels`, `_collect_inputs`, `_blocked_required_port`),
`deploy_service.py` (`_topological_order`, `_sources_by_target`) and `deploy/shared.py`
(`_collect_inputs_lines`) — and in `ConnectorEditor.tsx` / `GraphCanvas.tsx` on the
frontend. It is never per-node-type: no `elements/<type>/<type>_element.py` should know about
it.

## Shared contracts — coordinate before editing

These define the DSL every table above depends on. Changing them affects every node
type/widget kind at once, so they should be edited deliberately by the orchestrating
agent, not as part of a single-node-type task:

- `backend/app/models/graph.py` — `NodeType`, `GuiWidgetKind`, `GraphNode`/`GuiWidget`/`Port`/`GraphEdge` Pydantic models, `sync_gui_node_ports`.
- `frontend/src/types/graph.ts` — the mirrored TypeScript types.

Batching is also shared, and lives in `backend/app/services/batching.py`
(`reconcile_outputs`, `batch_inputs`, `merge_batch_outputs`) so both `graph_executor.py`
and any element's `execute`/`compile` can import it without a circular-import trick.
That module's behavior and the `_merge_batch_results` helper string embedded in
`deploy_service.py` must stay behaviorally identical, or a graph produces different
values in the editor than in its deployed bundle.

## Cross-cutting services (not per-node-type — read these when a task spans node types)

- `backend/app/services/graph_executor.py` — topological execution, batching, input/format resolution; delegates per-node work to `elements.registry.NODE_ELEMENTS[node.node_type].execute(...)`.
- `backend/app/services/deploy_service.py` — script/bundle assembly (imports, requirements detection); delegates per-node codegen to `elements.registry.NODE_ELEMENTS[node.node_type].compile(...)`.
- `backend/app/services/batching.py` — the shared batch-merge/reconcile helpers described above.
- `backend/app/services/ai_service.py`, `code_executor.py`, `file_service.py` — provider-agnostic AI calls, sandboxed code execution, file I/O helpers shared across node types.
- `frontend/src/components/NodeEditor.tsx` — modal shell (tabs/save-cancel/AI-generate handlers), dispatches to the per-node-type `ConfigEditor`s above.
- `frontend/src/components/GuiWidgetEditor.tsx` — widget list/add/remove/reorder, dispatches to the per-kind `ConfigEditor`s above.
- `frontend/src/store/graphStore.ts` — Zustand graph state (nodes/edges, load/save, port sync).

## Tests

Prefer **large, workflow-level tests** — a realistic multi-node graph run through
`execute_graph`, or the compiled deploy script actually executed as a subprocess — over
one test file per node type/compiler/executor. Splitting tests that finely fragments the
suite without making it more effective. See `backend/tests/test_graph.py`,
`test_gui_node.py`, `test_directory_to_code_forwarding.py`, and
`test_deploy_runner_execution.py` for the existing pattern before adding a new test file.

Adding a new `NodeType`/`GuiWidgetKind` or changing an existing element's behavior?
Extend the **consolidated element-contract tests** instead of writing a new per-element
test file: `backend/tests/test_element_contract.py` walks every registered element and
asserts add/remove, execute, compile, save/load round-trip, AI wiring (where applicable),
and execute-vs-compile consistency; `frontend/src/elements/elementContract.test.ts` walks
the same registries for `create`/`ports`/`ConfigEditor`/`RuntimeWidget` sanity.
