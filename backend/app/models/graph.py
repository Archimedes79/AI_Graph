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
    TEXT_INPUT = "text_input"
    FILE_INPUT = "file_input"
    DIRECTORY_INPUT = "directory_input"
    INPUT = "input"  # unified: text | file | directory
    AI = "ai"
    CODE = "code"
    OUTPUT = "output"
    TEXT_OUTPUT = "text_output"
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
    FILE_OPEN = "file_open"           # legacy → input_picker
    DIRECTORY_OPEN = "directory_open" # legacy → input_picker
    INPUT_PICKER = "input_picker"     # unified: file | directory
    TEXT_WINDOW = "text_window"       # legacy → text_io
    CHAT_WINDOW = "chat_window"       # legacy → text_io
    TEXT_IO = "text_io"               # unified: input | output | both
    PLOT_WINDOW = "plot_window"


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
    value: Optional[str] = None      # literal/default text, or a chosen file/directory path
    extensions: str = ""             # directory_open / input_picker extension filter, e.g. ".md, .txt"
    mode: str = ""                   # input_picker: "file" | "directory"
    size: Literal["small", "medium", "large"] = "medium"

    # input_picker (directory mode) – same file-selection contract as the legacy
    # directory_input node's NodeConfig fields, kept per-widget so a standalone
    # widget node has no different functionality from a directory_input node.
    recursive: bool = False
    select_all_files: bool = True
    selector_prompt: str = ""
    selector_code: str = ""          # run(inputs: {files}) -> {files}
    ai_provider: AIProvider = AIProvider.OLLAMA
    ai_model: str = "llama3"

    # Optional data-transform snippet for display-only widgets (currently plot_window).
    # Same contract as a CODE node: exposes run(inputs: dict) -> dict, executed via the
    # sandboxed code_executor. Receives {"value": <raw incoming data>} and should return
    # {"value": <plot-ready data>} -- a list of numbers, or a list of {x,y}/{label,value}
    # objects. Empty string means the raw incoming value passes through unchanged.
    code: str = ""
    language: Literal["python", "javascript"] = "python"

    # GUI-designer layout, in grid cells (12-column grid, row height is uniform).
    # Purely presentational: it never affects ports, execution, or wiring. None
    # means "not placed yet" -- the designer falls back to list order.
    x: Optional[int] = None
    y: Optional[int] = None
    w: int = 6
    h: int = 4


class NodeConfig(BaseModel):
    """Extra configuration that depends on node_type."""
    # text_input / file_input / directory_input
    value: Optional[str] = None           # literal value or path, also used as the
                                           # dialog's pre-filled default

    # output (file|directory write) only – text_input/file_input/directory_input
    # always prompt via a dialog before execution.
    prompt_at_runtime: bool = False

    # unified input node
    input_mode: Literal["text", "file", "directory"] = "text"

    # directory_input – file selection
    select_all_files: bool = True
    selector_prompt: str = ""
    selector_code: str = ""              # run(inputs: {files}) -> {files}

    # ai node -- runtime inference call only (the node's own execute())
    ai_provider: AIProvider = AIProvider.OLLAMA
    ai_model: str = "llama3"
    system_prompt: str = ""
    temperature: float = 0.7

    # Every design-time ✨ Generate call (code, system prompt, selector code,
    # output format) shares this one provider/model pair -- deliberately not
    # split per-purpose, and deliberately separate from ai_provider/ai_model
    # above so inference can stay on a cheap/local model while generation
    # uses a stronger one.
    gen_ai_provider: AIProvider = AIProvider.OLLAMA
    gen_ai_model: str = "llama3"

    # code node
    language: str = "python"             # python | javascript
    code: str = ""                       # generated / user-written code
    code_prompt: str = ""                # stored AI prompt used to generate the code

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

    # code / ai node – auto-read file content for file_path-typed inputs
    read_file_inputs: bool = False

    # output node
    output_label: str = "Result"
    write_mode: Literal["none", "file", "directory", "window"] = "none"  # window displays
                                          # result(s) in a text window (former text_output node type)

    # gui node – ordered list of composed widgets; ports are derived from this
    gui_widgets: List[GuiWidget] = Field(default_factory=list)
    # gui node – background raster the designer/runtime window lay widgets out
    # on, mirroring each widget's own foreground `size` (small/medium/large).
    gui_grid_columns: int = 12
    gui_grid_row_height: int = 56

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
# One-time legacy migration: `merge` / `split` node types were deleted in favor
# of equivalent `code` nodes (see AGENTS.md). Unlike the forever-lived aliases
# InputElement/OutputElement handle at execute() time, this migration rewrites
# the RAW node dict once, before it is validated into a NodeType enum member --
# "merge"/"split" never need to be valid NodeType values again afterward.
# ---------------------------------------------------------------------------

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

    # A "t+1" (feedback) edge: it carries the source's value from the PREVIOUS
    # execution round, not the current one. Deferred edges are excluded from
    # cycle detection and from topological ordering, which is what makes
    # otherwise-cyclic graphs runnable -- e.g. a gui node whose output feeds an
    # ai node that feeds a different widget on the same gui node. On the first
    # round a deferred edge delivers `initial_value` (None -> no value at all,
    # exactly like an unwired port).
    deferred: bool = False
    initial_value: Optional[Any] = None


class GraphMetadata(BaseModel):
    name: str = "Untitled Graph"
    version: str = "1.0.0"
    description: str = ""
    author: str = ""
    tags: List[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


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
        """Run _migrate_legacy_merge_split_node on every raw node dict before
        node_type is validated against the NodeType enum -- the migration
        insertion point for legacy `merge`/`split` graphs (see AGENTS.md)."""
        if isinstance(data, dict):
            nodes = data.get("nodes")
            if isinstance(nodes, list) and any(
                isinstance(n, dict) and n.get("node_type") in ("merge", "split") for n in nodes
            ):
                data = dict(data)
                data["nodes"] = [_migrate_legacy_merge_split_node(n) for n in nodes]
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
    ai_provider: AIProvider = AIProvider.OLLAMA
    ai_model: str = "llama3"


class GenerateCodeResponse(BaseModel):
    code: str
    language: str
    explanation: str = ""


class GeneratePromptRequest(BaseModel):
    description: str
    context: str = ""
    context_file: str = ""            # optional path; content is appended to context server-side
    ai_provider: AIProvider = AIProvider.OLLAMA
    ai_model: str = "llama3"


class GeneratePromptResponse(BaseModel):
    system_prompt: str
    explanation: str = ""


class GenerateOutputFormatRequest(BaseModel):
    """Ask the AI to describe the expected \"custom\" output format/shape for a node."""
    description: str
    context: str = ""
    context_file: str = ""            # optional path; content is appended to context server-side
    ai_provider: AIProvider = AIProvider.OLLAMA
    ai_model: str = "llama3"


class GenerateOutputFormatResponse(BaseModel):
    output_format_prompt: str
    explanation: str = ""


class GenerateGraphRequest(BaseModel):
    """Ask the AI to author a full Graph DSL document, not just one node."""
    description: str
    context: str = ""
    ai_provider: AIProvider = AIProvider.OLLAMA
    ai_model: str = "llama3"


class GenerateGraphResponse(BaseModel):
    graph: Graph  # validated against the same DSL schema used everywhere else
    explanation: str = ""
