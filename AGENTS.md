# Agent Navigation Guide

This file tells an AI coding agent — especially a cheap/fast model (`Cheap-Coder` /
`Cheap-Debugger`) given a narrow, single-file task — exactly where to look for a given
kind of change, so it doesn't need to read the whole codebase.

## Golden rule

If your task is scoped to **one node type** or **one GUI widget kind**, you almost
certainly only need to touch **one file per table row below** (plus, if behavior
changes, a matching workflow-level test). Do not open or edit files belonging to other
node types/widget kinds — that's how a big refactor stays safe for a cheap model to work
on in small pieces.

## Adding/changing a node type's behavior

| Node type | Deploy-bundle codegen (self-contained script) | Live execution (editor/API/CLI) | Frontend config panel |
|---|---|---|---|
| `text_input` | `backend/app/services/deploy/node_compilers/text_input.py` | `backend/app/services/executors/text_input.py` | `frontend/src/components/nodes/editors/InputEditor.tsx` |
| `file_input` | `.../node_compilers/file_input.py` | `.../executors/file_input.py` | `InputEditor.tsx` (shared) |
| `directory_input` | `.../node_compilers/directory_input.py` | `.../executors/directory_input.py` | `InputEditor.tsx` (shared) |
| `ai` | `.../node_compilers/ai.py` | `.../executors/ai.py` | `frontend/src/components/nodes/editors/AIEditor.tsx` |
| `code` | `.../node_compilers/code.py` | `.../executors/code.py` | `frontend/src/components/nodes/editors/CodeEditor.tsx` |
| `output` | `.../node_compilers/output.py` | `.../executors/output.py` | `frontend/src/components/nodes/editors/OutputEditor.tsx` |
| `text_output` | `.../node_compilers/text_output.py` | `.../executors/text_output.py` | `frontend/src/components/nodes/editors/TextOutputEditor.tsx` |
| `merge` / `split` | `.../node_compilers/merge.py` / `split.py` | `.../executors/merge.py` / `split.py` | `frontend/src/components/nodes/editors/MergeSplitEditor.tsx` |
| `gui` | `.../node_compilers/gui.py` (dispatches per widget, see below) | `.../executors/gui.py` (dispatches per widget, see below) | `frontend/src/components/nodes/editors/GuiEditor.tsx` (wraps `GuiWidgetEditor.tsx`) |

Registries — only touch these if you're **adding a brand-new node type**, not changing
an existing one: `deploy/node_compilers/__init__.py` (`NODE_COMPILERS`),
`executors/__init__.py` (`NODE_EXECUTORS`).

## Adding/changing a GUI widget kind

| Widget kind | Deploy-bundle codegen | Live execution | Frontend config panel | Frontend runtime widget |
|---|---|---|---|---|
| `file_open` | `backend/app/services/deploy/gui_widget_compilers/file_open.py` | `backend/app/services/gui_widgets/file_open.py` | `frontend/src/components/widgets/editors/FileOpenEditor.tsx` | `frontend/src/components/gui/widgets/FileOpenWidget.tsx` |
| `directory_open` | `.../gui_widget_compilers/directory_open.py` | `.../gui_widgets/directory_open.py` | `frontend/src/components/widgets/editors/DirectoryOpenEditor.tsx` | `.../gui/widgets/DirectoryOpenWidget.tsx` |
| `text_window` | `.../gui_widget_compilers/text_window.py` | `.../gui_widgets/text_window.py` | `frontend/src/components/widgets/editors/TextChatEditor.tsx` (shared with `chat_window`) | `.../gui/widgets/TextWindowWidget.tsx` |
| `chat_window` | `.../gui_widget_compilers/chat_window.py` | `.../gui_widgets/chat_window.py` | `TextChatEditor.tsx` (shared with `text_window`) | `.../gui/widgets/ChatWindowWidget.tsx` |
| `plot_window` | `.../gui_widget_compilers/plot_window.py` | inline in `executors/gui.py` (display-only, no output port) | `frontend/src/components/widgets/editors/PlotWindowEditor.tsx` | `.../gui/widgets/PlotWindowWidget.tsx` (wraps `PlotWidget.tsx`) |

Registries: `deploy/gui_widget_compilers/__init__.py` (`GUI_WIDGET_COMPILERS`),
`gui_widgets/__init__.py` (`GUI_WIDGET_EXECUTORS`), and
`frontend/src/components/gui/widgets/index.ts` (runtime kind -> component).

A widget kind therefore has **five** files, one per column above — adding a kind means
adding five small files plus three registry lines, and touching nothing else.

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
frontend. It is never per-node-type: no file under `executors/` or `node_compilers/`
should know about it.

## Shared contracts — coordinate before editing

These define the DSL every table above depends on. Changing them affects every node
type/widget kind at once, so they should be edited deliberately by the orchestrating
agent, not as part of a single-node-type task:

- `backend/app/models/graph.py` — `NodeType`, `GuiWidgetKind`, `GraphNode`/`GuiWidget`/`Port`/`GraphEdge` Pydantic models, `sync_gui_node_ports`.
- `frontend/src/types/graph.ts` — the mirrored TypeScript types.

Batching is also shared: `_merge_batch_outputs` in `graph_executor.py` and the
`_merge_batch_results` helper string in `deploy_service.py` must stay behaviorally
identical, or a graph produces different values in the editor than in its deployed
bundle.

## Cross-cutting services (not per-node-type — read these when a task spans node types)

- `backend/app/services/graph_executor.py` — topological execution, batching, input/format resolution; delegates per-node work to `executors/`.
- `backend/app/services/deploy_service.py` — script/bundle assembly (imports, requirements detection); delegates per-node codegen to `deploy/node_compilers/`.
- `backend/app/services/ai_service.py`, `code_executor.py`, `file_service.py` — provider-agnostic AI calls, sandboxed code execution, file I/O helpers shared across node types.
- `frontend/src/components/NodeEditor.tsx` — modal shell (tabs/save-cancel/AI-generate handlers), dispatches to the per-node-type editors above.
- `frontend/src/components/GuiWidgetEditor.tsx` — widget list/add/remove/reorder, dispatches to the per-kind editors above.
- `frontend/src/store/graphStore.ts` — Zustand graph state (nodes/edges, load/save, port sync).

## Tests

Prefer **large, workflow-level tests** — a realistic multi-node graph run through
`execute_graph`, or the compiled deploy script actually executed as a subprocess — over
one test file per node type/compiler/executor. Splitting tests that finely fragments the
suite without making it more effective. See `backend/tests/test_graph.py`,
`test_gui_node.py`, `test_directory_to_code_forwarding.py`, and
`test_deploy_runner_execution.py` for the existing pattern before adding a new test file.
