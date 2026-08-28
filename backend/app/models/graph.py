"""
Graph DSL data models.

A Graph is a directed, acyclic (or cyclic-safe-execution) collection of Nodes
connected by Edges.  Each Node declares typed Ports (inputs / outputs).
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class NodeType(str, Enum):
    INPUT = "input"  # unified: text | file | directory
    AI = "ai"
    CODE = "code"
    DATA = "data"
    OUTPUT = "output"
    GUI = "gui"
    WIDGET = "widget"  # a single GuiWidget standalone on the canvas -- see gui_element.py


class PortKind(str, Enum):
    INPUT = "input"
    OUTPUT = "output"


class DataType(str, Enum):
    TEXT = "text"
    FILE_PATH = "file_path"
    BINARY = "binary"
    JSON = "json"
    LIST = "list"
    ANY = "any"


class AIProvider(str, Enum):
    # "Whatever this run is configured to use" -- the default for a new AI
    # node, resolved once per run by app.services.ai_settings (env var, an
    # ai-settings.json next to the deployed tool, or the graph's own
    # metadata.ai_defaults). Naming a real provider below pins the node to it.
    DEFAULT = "default"
    OLLAMA = "ollama"
    OPENAI = "openai"
    OPENAI_COMPATIBLE = "openai_compatible"
    ANTHROPIC = "anthropic"
    LMSTUDIO = "lmstudio"
    GITHUB_COPILOT = "github_copilot"  # GitHub Models API, OpenAI-compatible; needs GITHUB_TOKEN


# ---------------------------------------------------------------------------
# Port & Node definitions
# ---------------------------------------------------------------------------

class Port(BaseModel):
    id: str
    name: str
    kind: PortKind
    data_type: DataType = DataType.ANY
    multi: bool = False          # True -> accepts / produces an unbounded batch
    required: bool = True
    description: str = ""
    format: Optional[str] = None  # e.g. application/json, text/csv, image/png
    debug_directory: Optional[str] = None


class NodePosition(BaseModel):
    x: float = 0.0
    y: float = 0.0


class GuiWidgetKind(str, Enum):
    INPUT_PICKER = "input_picker"     # unified: file | directory
    TEXT_IO = "text_io"               # unified: input | output | both
    PLOT_WINDOW = "plot_window"
    IMAGE_VIEW = "image_view"       # display-only: shows a picture from a path


class GuiWidget(BaseModel):
    """
    One element inside a GUI node. Ports are never edited by hand: they are
    always regenerated from this list (see `sync_gui_node_ports`), so a
    widget's `id` must stay stable once assigned -- it is the only thing
    that keeps existing edges attached across GUI edits.
    """
    id: str
    kind: GuiWidgetKind
    label: str = ""
    value: Optional[Any] = None      # literal/default value or a chosen file/directory path
    extensions: str = ""             # input_picker (directory mode) extension filter, e.g. ".md, .txt"
    mode: str = ""                   # input_picker: "file" | "directory"; text_io: "input" | "output" | "both"
    size: Literal["small", "medium", "large"] = "medium"

    # input_picker (directory mode) – same file-selection contract as the input
    # node's NodeConfig fields, kept per-widget so a standalone widget node has
    # no different functionality from an input node in directory mode.
    recursive: bool = False
    select_all_files: bool = True
    selector_prompt: str = ""
    selector_code: str = ""          # run(inputs: {files}) -> {files}
    # No per-widget generation provider/model: every design-time "Generate"
    # call in the editor uses the one editor-wide code-generation AI (a
    # workstation setting, not graph data -- see frontend/src/store/
    # settingsStore.ts). Widgets written before that carried ai_provider /
    # ai_model here; pydantic's default extra="ignore" drops them on load.

    # Optional data-transform snippet for display-only widgets (currently plot_window).
    # Same contract as a CODE node: exposes run(inputs: dict) -> dict, executed via the
    # sandboxed code_executor. Receives {"value": <raw incoming data>} and should return
    # {"value": <plot-ready data>} -- a list of numbers, or a list of {x,y}/{label,value}
    # objects. Empty string means the raw incoming value passes through unchanged.
    code: str = ""
    language: Literal["python", "javascript"] = "python"
    plot_prompt: str = ""            # design-time prompt used to generate plot transform code
    example_input_path: str = ""     # optional sample file used as generation context

    # GUI-designer layout, in grid cells (12-column grid, row height is uniform).
    # Purely presentational: it never affects ports, execution, or wiring. None
    # means "not placed yet" -- the designer falls back to list order.
    x: Optional[int] = None
    y: Optional[int] = None
    w: int = 6
    h: int = 4


class NodeConfig(BaseModel):
    """Extra configuration that depends on node_type."""
    # input node
    value: Optional[str] = None           # literal value or path, also used as the
                                           # dialog's pre-filled default

    # input node: prompt via a dialog before execution (pre-filled with `value`).
    # output node (file|directory write): prompt for the write target.
    prompt_at_runtime: bool = False

    # unified input node
    input_mode: Literal["text", "file", "directory"] = "text"

    # input node (directory mode) – file selection
    select_all_files: bool = True
    selector_prompt: str = ""
    selector_code: str = ""              # run(inputs: {files}) -> {files}

    # ai node -- runtime inference call only (the node's own execute()).
    # DEFAULT means "follow this run's AI configuration" (see AIProvider.DEFAULT
    # and app.services.ai_settings), which is what lets one deployed graph be
    # pointed at a local LM Studio or a hosted endpoint without editing it.
    # Naming a provider here pins this node to it regardless.
    ai_provider: AIProvider = AIProvider.DEFAULT
    ai_model: str = ""                   # "" -> the run's configured model
    system_prompt: str = ""
    temperature: float = 0.7

    # NOTE: there are deliberately no gen_ai_provider/gen_ai_model fields here.
    # Which AI writes your code and prompts is a property of the workstation
    # doing the authoring, not of the graph: it never affects execution, it is
    # the same for every node, and a graph shared with someone else should not
    # carry your model choice. It lives in one editor-wide setting instead
    # (frontend/src/store/settingsStore.ts, with AI_GRAPH_GEN_PROVIDER /
    # AI_GRAPH_GEN_MODEL as the server-side fallback). Older graphs carrying
    # these fields load unchanged -- pydantic's default extra="ignore".

    # code node
    language: str = "python"             # python | javascript
    code: str = ""                       # generated / user-written code
    code_prompt: str = ""                # stored AI prompt used to generate the code
    # code node (python) -- pip requirements this snippet needs, e.g. ["pandas>=2.0"].
    # A code node is the universal escape hatch, but only reaches as far as what it
    # can import; declaring that here is what lets a deploy bundle's requirements.txt
    # know about it and what turns a missing package into a sentence instead of a
    # traceback. Installed into one shared environment -- see services/code_env.py.
    requirements: List[str] = Field(default_factory=list)

    # data node -- a persisted value plus its design-time format contract.
    # The value is updated after a cycle-closing feedback edge settles, making
    # the node a deterministic register rather than a runtime AI call.
    data_value: Optional[Any] = None
    data_format: Literal["text", "structure"] = "text"
    data_prompt: str = ""
    data_format_prompt: str = ""

    # Config tab -- optional context file (path) whose content is appended as
    # extra context to every ✨ Generate call in the Config tab (code, system
    # prompt, selector code). Read server-side via file_service, same as any
    # other path field; see routers/ai.py.
    config_context_file: str = ""

    # per-node output format declaration (used in AI generation prompts)
    output_format: Literal["text", "json", "csv", "csv_list", "custom"] = "text"
    output_format_prompt: str = ""       # description for custom format

    # Output tab -- optional context file (path) whose content is appended as
    # extra context when generating output_format_prompt via AI ("Generate
    # Output Format from prompt"). Independent of config_context_file above.
    output_context_file: str = ""

    # code / ai node – batch handling
    # per_item: run() is invoked once per batch element (existing behaviour).
    # whole_list: run() is invoked once with the full, unexpanded multi-port list(s),
    # enabling "reduce" style aggregation (e.g. summing counts across all items).
    batch_mode: Literal["per_item", "whole_list"] = "per_item"

    # code / ai node – how many `per_item` batch elements may be in flight at once.
    # 0 means "use the run's default" (AI_GRAPH_BATCH_CONCURRENCY, itself 4), which
    # is what makes a thousand-item batch finish in minutes rather than hours. Set
    # it to 1 on a node whose provider rate-limits, or whose items must run in order.
    batch_concurrency: int = Field(default=0, ge=0, le=64)

    # code / ai node – auto-read file content for file_path-typed inputs
    read_file_inputs: bool = False

    # output node
    output_label: str = "Result"
    write_mode: Literal["none", "file", "directory", "window"] = "none"  # window displays
                                          # result(s) in a text window

    # gui node – ordered list of composed widgets; ports are derived from this
    gui_widgets: List[GuiWidget] = Field(default_factory=list)
    # gui node – background column raster the designer/runtime window lay
    # widgets out on horizontally (row height is a fixed constant, see
    # frontend/src/components/gui/layout.ts).
    gui_grid_columns: int = 12

    extra: Dict[str, Any] = Field(default_factory=dict)


class GraphNode(BaseModel):
    id: str
    node_type: NodeType
    label: str
    description: str = ""
    position: NodePosition = Field(default_factory=NodePosition)
    width: Optional[float] = None    # persisted ReactFlow size, e.g. for resizable gui nodes
    height: Optional[float] = None
    inputs: List[Port] = Field(default_factory=list)
    outputs: List[Port] = Field(default_factory=list)
    config: NodeConfig = Field(default_factory=NodeConfig)


def gui_widget_ports(widget: GuiWidget) -> tuple[List[Port], List[Port]]:
    """
    Return the (inputs, outputs) a single GUI widget contributes to its node.
    Delegates to that widget kind's `GuiWidgetElement.ports()` (see
    `app.elements.base` / AGENTS.md) so the widget's own class is the single
    source of truth for its ports -- this module only orchestrates the
    resulting DSL. Local import: `app.elements.registry` imports this module,
    so importing it at module level here would be circular.
    """
    from app.elements.registry import GUI_WIDGET_ELEMENTS

    element = GUI_WIDGET_ELEMENTS.get(widget.kind)
    if element is None:
        raise ValueError(f"Unknown GUI widget kind: {widget.kind}")
    return element.ports(widget)


def sync_gui_node_ports(node: GraphNode) -> None:
    """
    Regenerate a GUI/WIDGET node's inputs/outputs strictly from
    `config.gui_widgets`, in order. No-op for any other node type. Call this
    after any widget-list edit instead of hand-editing `inputs`/`outputs`
    directly. A WIDGET node is just a GUI node whose `gui_widgets` happens to
    hold exactly one widget -- same derivation, same element (see gui_element.py).
    """
    if node.node_type not in (NodeType.GUI, NodeType.WIDGET):
        return
    inputs: List[Port] = []
    outputs: List[Port] = []
    for widget in node.config.gui_widgets:
        widget_inputs, widget_outputs = gui_widget_ports(widget)
        inputs.extend(widget_inputs)
        outputs.extend(widget_outputs)
    node.inputs = inputs
    node.outputs = outputs


# ---------------------------------------------------------------------------
# One-time legacy migrations. Two flavors, both rewriting the RAW node dict
# before it is validated into a NodeType/GuiWidgetKind enum member:
#   * `merge` / `split` node types were deleted in favor of equivalent `code`
#     nodes (literal generated code below).
#   * The legacy alias node types (`text_input`/`file_input`/`directory_input`
#     -> `input`, `text_output` -> `output`) and widget kinds (`file_open`/
#     `directory_open` -> `input_picker`, `text_window`/`chat_window` ->
#     `text_io`) were retired in favor of their unified elements; the alias
#     names are no longer valid enum values (see AGENTS.md).
# ---------------------------------------------------------------------------

_LEGACY_NODE_TYPES = {"merge", "split", "text_input", "file_input", "directory_input", "text_output"}

# legacy widget kind -> (canonical kind, mode)
_LEGACY_WIDGET_KINDS = {
    "file_open": ("input_picker", "file"),
    "directory_open": ("input_picker", "directory"),
    "text_window": ("text_io", "both"),
    "chat_window": ("text_io", "both"),
}

# legacy input node type -> input_mode; these nodes always prompted at runtime.
_LEGACY_INPUT_MODES = {"text_input": "text", "file_input": "file", "directory_input": "directory"}


def _migrate_legacy_alias_node(node: dict) -> dict:
    """Rewrite one legacy alias node dict (input/output family) in place-copy
    style: ports/edges keep resolving because ids are untouched."""
    node_type = node.get("node_type")
    config = dict(node.get("config") or {})
    migrated = dict(node)
    if node_type in _LEGACY_INPUT_MODES:
        config["input_mode"] = _LEGACY_INPUT_MODES[node_type]
        config["prompt_at_runtime"] = True  # legacy input nodes always prompted
        migrated["node_type"] = "input"
    elif node_type == "text_output":
        config["write_mode"] = "window"
        migrated["node_type"] = "output"
    migrated["config"] = config
    return migrated


def _migrate_legacy_widgets(node: dict) -> dict:
    """Rewrite legacy widget kinds inside a node's config.gui_widgets. Widget
    ids are untouched, so the derived `{id}_in`/`{id}_out` ports keep edges
    attached."""
    config = node.get("config")
    if not isinstance(config, dict):
        return node
    widgets = config.get("gui_widgets")
    if not isinstance(widgets, list):
        return node
    new_widgets = []
    changed = False
    for widget in widgets:
        if isinstance(widget, dict) and widget.get("kind") in _LEGACY_WIDGET_KINDS:
            kind, mode = _LEGACY_WIDGET_KINDS[widget["kind"]]
            widget = {**widget, "kind": kind, "mode": widget.get("mode") or mode}
            changed = True
        new_widgets.append(widget)
    if not changed:
        return node
    migrated = dict(node)
    migrated["config"] = {**config, "gui_widgets": new_widgets}
    return migrated


def _migrate_legacy_node(node: Any) -> Any:
    if not isinstance(node, dict):
        return node
    node_type = node.get("node_type")
    if node_type in ("merge", "split"):
        return _migrate_legacy_merge_split_node(node)
    if node_type in _LEGACY_NODE_TYPES:
        node = _migrate_legacy_alias_node(node)
    return _migrate_legacy_widgets(node)


def _generate_merge_code(mode: str, separator: str) -> str:
    """Literal `run(inputs)` source equivalent to the deleted MergeElement.execute() for *mode*."""
    if mode == "sum":
        return (
            "def run(inputs):\n"
            "    flat = []\n"
            "    for val in inputs.values():\n"
            "        if isinstance(val, list):\n"
            "            flat.extend(v for v in val if v is not None)\n"
            "        elif val is not None:\n"
            "            flat.append(val)\n"
            "    total = sum(float(v) for v in flat)\n"
            "    return {'output': int(total) if total.is_integer() else total}\n"
        )
    if mode == "count":
        return (
            "def run(inputs):\n"
            "    flat = []\n"
            "    for val in inputs.values():\n"
            "        if isinstance(val, list):\n"
            "            flat.extend(v for v in val if v is not None)\n"
            "        elif val is not None:\n"
            "            flat.append(val)\n"
            "    return {'output': len(flat)}\n"
        )
    if mode == "json_list":
        return (
            "import json\n"
            "\n"
            "\n"
            "def run(inputs):\n"
            "    flat = []\n"
            "    for val in inputs.values():\n"
            "        if isinstance(val, list):\n"
            "            flat.extend(v for v in val if v is not None)\n"
            "        elif val is not None:\n"
            "            flat.append(val)\n"
            "    return {'output': json.dumps(flat)}\n"
        )
    # concat -- also the fallback for an unrecognized legacy mode, matching the
    # deleted MergeElement's own fallback-to-concat behavior.
    return (
        "def run(inputs):\n"
        "    parts = []\n"
        "    for val in inputs.values():\n"
        "        if isinstance(val, list):\n"
        "            parts.extend(str(v) for v in val)\n"
        "        elif val is not None:\n"
        "            parts.append(str(val))\n"
        f"    return {{'output': {separator!r}.join(parts)}}\n"
    )


def _generate_split_code(separator: str) -> str:
    """Literal `run(inputs)` source equivalent to the deleted SplitElement.execute()."""
    return (
        "def run(inputs):\n"
        "    source = next(iter(inputs.values()), '')\n"
        f"    parts = str(source).split({separator!r}) if source else []\n"
        "    return {'items': parts, 'count': len(parts)}\n"
    )


def _migrate_legacy_merge_split_node(node: Any) -> Any:
    """Rewrite one legacy `merge`/`split` node dict into an equivalent `code` node
    dict. Ports (id/label/description/position/inputs/outputs) are preserved
    exactly so existing edges keep resolving; merge_mode/separator are baked
    into literal generated code and dropped from config."""
    if not isinstance(node, dict):
        return node
    node_type = node.get("node_type")
    if node_type not in ("merge", "split"):
        return node
    config = dict(node.get("config") or {})
    separator = config.pop("separator", "\n")
    if node_type == "merge":
        mode = config.pop("merge_mode", "concat")
        config["code"] = _generate_merge_code(mode, separator)
    else:
        config.pop("merge_mode", None)
        config["code"] = _generate_split_code(separator)
    config["language"] = "python"
    config["batch_mode"] = "whole_list"
    migrated = dict(node)
    migrated["node_type"] = "code"
    migrated["config"] = config
    return migrated


class GraphEdge(BaseModel):
    id: str
    source_node_id: str
    source_port_id: str
    target_node_id: str
    target_port_id: str

    # Edges into a gui/widget node's input are never a node-level ordering
    # constraint: that node is a "memory" element, so an edge closing a cycle
    # back onto one (e.g. gui -> ai -> the same gui) is auto-excluded from
    # cycle detection and settled into the target widget's own persisted
    # `value` once the rest of the round has executed, instead of blocking on
    # it. See graph_executor.py's "memory feedback" section and AGENTS.md.


class AIDefaults(BaseModel):
    """
    The graph's own answer to "which AI should my `default` AI nodes use?",
    set once in the editor instead of once per node. It is the lowest-priority
    source: an AI_GRAPH_AI_PROVIDER environment variable, an ai-settings.json
    beside the deployed tool, or a CLI flag all override it at run time, which
    is how the same shipped graph runs against a local model on one machine
    and a hosted endpoint on another. See app.services.ai_settings.
    """
    provider: AIProvider = AIProvider.DEFAULT
    model: str = ""


class GraphMetadata(BaseModel):
    name: str = "Untitled Graph"
    version: str = "1.0.0"
    description: str = ""
    author: str = ""
    tags: List[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    ai_defaults: AIDefaults = Field(default_factory=AIDefaults)


class Graph(BaseModel):
    """
    Top-level graph document – this is the Graph DSL schema.
    Serialised to / from JSON for storage, execution, and deployment.
    """
    metadata: GraphMetadata = Field(default_factory=GraphMetadata)
    nodes: List[GraphNode] = Field(default_factory=list)
    edges: List[GraphEdge] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_nodes(cls, data: Any) -> Any:
        """Run _migrate_legacy_node on every raw node dict before node_type /
        widget kind is validated against its enum -- the migration insertion
        point for legacy graphs (see AGENTS.md)."""
        if isinstance(data, dict):
            nodes = data.get("nodes")
            if isinstance(nodes, list):
                migrated = [_migrate_legacy_node(n) for n in nodes]
                if any(m is not n for m, n in zip(migrated, nodes)):
                    data = dict(data)
                    data["nodes"] = migrated
        return data


# ---------------------------------------------------------------------------
# Execution models
# ---------------------------------------------------------------------------

class ExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    SKIPPED = "skipped"
    # Some items of a `per_item` batch failed and the rest succeeded. The node
    # still delivers its outputs downstream (failed positions carry None, so a
    # batch stays index-aligned with its input) -- losing 2,000 successful items
    # because item 1,900 raised is worse than delivering 1,999 and saying so.
    PARTIAL = "partial"
    # The run was stopped on request. Nodes that had already finished keep their
    # own status; the run as a whole reports this.
    CANCELLED = "cancelled"


class NodeResult(BaseModel):
    node_id: str
    status: ExecutionStatus
    inputs: Dict[str, Any] = Field(default_factory=dict)
    outputs: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    duration_ms: Optional[float] = None


class ExecutionResult(BaseModel):
    graph_id: Optional[str] = None
    status: ExecutionStatus
    node_results: List[NodeResult] = Field(default_factory=list)
    final_outputs: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    duration_ms: Optional[float] = None


class RuntimeRequirement(BaseModel):
    """A file/directory path that must be supplied before the graph can run."""
    node_id: str
    label: str
    kind: Literal["text", "file", "directory"]
    direction: Literal["input", "output"]
    current_value: str = ""
    widget_id: Optional[str] = None  # set when the requirement is a GUI node's widget


# ---------------------------------------------------------------------------
# AI-generation request
# ---------------------------------------------------------------------------

class GenerateCodeRequest(BaseModel):
    description: str
    language: str = "python"
    context: str = ""
    context_file: str = ""            # optional path; content is appended to context server-side
    inputs: List[str] = Field(default_factory=list)
    outputs: List[str] = Field(default_factory=list)
    # Empty/DEFAULT -> the server's own code-generation default
    # (AI_GRAPH_GEN_PROVIDER / AI_GRAPH_GEN_MODEL, or ai-settings.json's
    # "codegen" section). The editor normally sends its one configured
    # generation AI explicitly; see ai_settings.resolve_gen_target.
    ai_provider: AIProvider = AIProvider.DEFAULT
    ai_model: str = ""


class GenerateCodeResponse(BaseModel):
    code: str
    language: str
    explanation: str = ""


class GeneratePromptRequest(BaseModel):
    description: str
    context: str = ""
    context_file: str = ""            # optional path; content is appended to context server-side
    # Empty/DEFAULT -> the server's own code-generation default
    # (AI_GRAPH_GEN_PROVIDER / AI_GRAPH_GEN_MODEL, or ai-settings.json's
    # "codegen" section). The editor normally sends its one configured
    # generation AI explicitly; see ai_settings.resolve_gen_target.
    ai_provider: AIProvider = AIProvider.DEFAULT
    ai_model: str = ""


class GeneratePromptResponse(BaseModel):
    system_prompt: str
    explanation: str = ""


class GenerateOutputFormatRequest(BaseModel):
    """Ask the AI to describe the expected \"custom\" output format/shape for a node."""
    description: str
    context: str = ""
    context_file: str = ""            # optional path; content is appended to context server-side
    # Empty/DEFAULT -> the server's own code-generation default
    # (AI_GRAPH_GEN_PROVIDER / AI_GRAPH_GEN_MODEL, or ai-settings.json's
    # "codegen" section). The editor normally sends its one configured
    # generation AI explicitly; see ai_settings.resolve_gen_target.
    ai_provider: AIProvider = AIProvider.DEFAULT
    ai_model: str = ""


class GenerateOutputFormatResponse(BaseModel):
    output_format_prompt: str
    explanation: str = ""


class GenerateGraphRequest(BaseModel):
    """Ask the AI to author a full Graph DSL document, not just one node."""
    description: str
    context: str = ""
    # Empty/DEFAULT -> the server's own code-generation default
    # (AI_GRAPH_GEN_PROVIDER / AI_GRAPH_GEN_MODEL, or ai-settings.json's
    # "codegen" section). The editor normally sends its one configured
    # generation AI explicitly; see ai_settings.resolve_gen_target.
    ai_provider: AIProvider = AIProvider.DEFAULT
    ai_model: str = ""


class GenerateGraphResponse(BaseModel):
    graph: Graph  # validated against the same DSL schema used everywhere else
    explanation: str = ""
