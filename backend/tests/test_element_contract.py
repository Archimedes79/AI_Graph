"""
Consolidated element-contract test.

Walks every registered `NodeElement` (`elements.registry.NODE_ELEMENTS`) and
`GuiWidgetElement` (`elements.registry.GUI_WIDGET_ELEMENTS`) and asserts the
handful of universal properties every element must satisfy -- see AGENTS.md's
"Object-oriented element contract". This REPLACES ad-hoc per-element unit
tests: when adding a new NodeType/GuiWidgetKind, extend the per-type tables
below instead of adding a new test file.

There is no more `compile()` to check for consistency against `execute()`:
since deploy bundles now vendor the real `execute()` code verbatim (see
`deploy_service.py`), the two can never diverge -- that end-to-end guarantee
is instead exercised by `test_deploy_runner_execution.py`, which runs a real
bundle as a subprocess and compares its output to `execute_graph()`.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.elements.registry import (  # noqa: E402
    GUI_WIDGET_ELEMENTS,
    NODE_ELEMENTS,
    generation_for,
)
from app.models.graph import (  # noqa: E402
    AIProvider,
    DataType,
    Graph,
    GraphEdge,
    GraphNode,
    GuiWidget,
    GuiWidgetKind,
    NodeConfig,
    NodeType,
    Port,
    PortKind,
    sync_gui_node_ports,
)
from app.services import ai_service  # noqa: E402
from app.services.graph_executor import ExecutionStatus, execute_graph  # noqa: E402

CODE_ECHO = "def run(inputs):\n    return {'output': inputs.get('input', '')}\n"


def _port(id_: str, kind: PortKind, data_type: DataType = DataType.ANY, multi: bool = False, required: bool = False) -> Port:
    return Port(id=id_, name=id_, kind=kind, data_type=data_type, multi=multi, required=required)


def _minimal_inputs_for(ports: List[Port]) -> Dict[str, Any]:
    """A small per-datatype default inputs dict from a node's/widget's declared input ports."""
    inputs: Dict[str, Any] = {}
    for port in ports:
        if port.multi:
            inputs[port.id] = []
        elif not port.required:
            continue
        elif port.data_type == DataType.TEXT:
            inputs[port.id] = ""
        elif port.data_type == DataType.JSON:
            inputs[port.id] = {}
        elif port.data_type == DataType.LIST:
            inputs[port.id] = []
        else:
            inputs[port.id] = None
    return inputs


def _install_ai_stubs(monkeypatch) -> List[dict]:
    """Monkeypatch ai_service so no element under test ever makes a real network call."""
    calls: List[dict] = []

    async def stub_complete(prompt, system="", model="", temperature=0.7, provider=AIProvider.DEFAULT):
        calls.append({"kind": "complete", "prompt": prompt, "system": system, "model": model,
                      "temperature": temperature, "provider": provider})
        return "STUB_COMPLETION"

    async def stub_generate_code(description, language="python", context="", inputs=None, outputs=None,
                                  model="", provider=AIProvider.DEFAULT):
        calls.append({"kind": "generate_code", "description": description, "language": language,
                      "context": context, "inputs": inputs or [], "outputs": outputs or [],
                      "model": model, "provider": provider})
        return ("def run(inputs):\n    return {'files': inputs.get('files', [])}\n", "explanation")

    monkeypatch.setattr(ai_service, "complete", stub_complete)
    monkeypatch.setattr(ai_service, "generate_code", stub_generate_code)
    return calls


# ---------------------------------------------------------------------------
# Node fixtures -- one minimal, executable GraphNode per NodeType.
# ---------------------------------------------------------------------------

def _make_node(node_type: NodeType, tmp_path: Path) -> GraphNode:
    nid = f"n_{node_type.value}"
    if node_type == NodeType.INPUT:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          outputs=[_port("output", PortKind.OUTPUT, DataType.TEXT)],
                          config=NodeConfig(value="hello", input_mode="text"))
    if node_type == NodeType.AI:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          inputs=[_port("prompt", PortKind.INPUT, DataType.TEXT, multi=True)],
                          outputs=[_port("output", PortKind.OUTPUT, DataType.TEXT, multi=True)],
                          config=NodeConfig(system_prompt="sys"))
    if node_type == NodeType.CODE:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          inputs=[_port("input", PortKind.INPUT, DataType.ANY, multi=True)],
                          outputs=[_port("output", PortKind.OUTPUT, DataType.ANY, multi=True)],
                          config=NodeConfig(code=CODE_ECHO))
    if node_type == NodeType.DATA:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          inputs=[_port("input", PortKind.INPUT, DataType.ANY)],
                          outputs=[_port("output", PortKind.OUTPUT, DataType.ANY)],
                          config=NodeConfig(data_value={"answer": 42}, data_format="structure"))
    if node_type == NodeType.OUTPUT:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          inputs=[_port("value", PortKind.INPUT, DataType.ANY, multi=True)],
                          config=NodeConfig(output_label="Result"))
    if node_type == NodeType.GUI:
        node = GraphNode(id=nid, node_type=node_type, label="L", config=NodeConfig(gui_widgets=[]))
        sync_gui_node_ports(node)
        return node
    if node_type == NodeType.WIDGET:
        widget = GuiWidget(id="w1", kind=GuiWidgetKind.TEXT_IO, label="W", value="hello", mode="input")
        node = GraphNode(id=nid, node_type=node_type, label="L", config=NodeConfig(gui_widgets=[widget]))
        sync_gui_node_ports(node)
        return node
    raise AssertionError(f"no fixture for {node_type}")


# Elements whose execute() plausibly calls out to an AI model.
AI_CAPABLE_NODE_TYPES = {NodeType.AI, NodeType.INPUT}


async def _assert_ai_call_path(node_type: NodeType, element, tmp_path: Path, monkeypatch) -> None:
    if node_type not in AI_CAPABLE_NODE_TYPES:
        return  # output/gui/... never call AI -- nothing to verify.
    calls = _install_ai_stubs(monkeypatch)

    if node_type == NodeType.AI:
        node = GraphNode(
            id="ai_check", node_type=node_type, label="AI",
            inputs=[_port("prompt", PortKind.INPUT, DataType.TEXT, multi=True)],
            outputs=[_port("output", PortKind.OUTPUT, DataType.TEXT, multi=True)],
            config=NodeConfig(system_prompt="sys", ai_model="m1", ai_provider=AIProvider.OLLAMA, temperature=0.5),
        )
        await element.execute(node, {"prompt": "hello"})
        assert len(calls) == 1 and calls[0]["kind"] == "complete"
        assert calls[0]["model"] == "m1"
        assert calls[0]["provider"] == AIProvider.OLLAMA
        assert calls[0]["system"] == "sys"
        return

    # NodeType.INPUT in directory mode with a selector_prompt.
    (tmp_path / "keep.txt").write_text("x", encoding="utf-8")
    node = GraphNode(
        id="dir_ai_check", node_type=node_type, label="Dir",
        inputs=[_port("path", PortKind.INPUT, DataType.FILE_PATH)],
        outputs=[_port("files", PortKind.OUTPUT, DataType.FILE_PATH, multi=True),
                 _port("count", PortKind.OUTPUT, DataType.TEXT)],
        config=NodeConfig(
            value=str(tmp_path), select_all_files=False, selector_code="",
            selector_prompt="pick files", input_mode="directory",
        ),
    )
    await element.execute(node, {})
    assert len(calls) == 1 and calls[0]["kind"] == "generate_code"
    assert calls[0]["description"] == "pick files"
    assert calls[0]["inputs"] == ["files"]
    assert calls[0]["outputs"] == ["files"]
    # No model and no provider: this last-resort generation follows whatever AI
    # the run is configured with, exactly as the input_picker widget's identical
    # call always did. The node used to pass its own `ai_model`/`ai_provider`
    # here -- one behaviour, two answers, depending on which level you asked.


@pytest.mark.parametrize("node_type, element", list(NODE_ELEMENTS.items()), ids=[t.value for t in NODE_ELEMENTS])
async def test_node_element_contract(node_type: NodeType, element, tmp_path, monkeypatch):
    node = _make_node(node_type, tmp_path)

    # 1. Can be added/removed -- schema smoke test.
    with_it = Graph(nodes=[node])
    assert len(with_it.nodes) == 1
    without_it = Graph(nodes=[])
    assert without_it.nodes == []

    # 2. Executed.
    _install_ai_stubs(monkeypatch)
    inputs = _minimal_inputs_for(node.inputs)
    result = await element.execute(node, dict(inputs))
    assert isinstance(result, dict)

    # 3. Saving and loading works.
    restored = GraphNode.model_validate_json(node.model_dump_json())
    assert restored == node

    # 4. AI can be called (only for AI-capable node types; no-op otherwise).
    await _assert_ai_call_path(node_type, element, tmp_path, monkeypatch)


async def test_data_element_persists_cycle_feedback_for_next_run():
    data_node = GraphNode(
        id="memory", node_type=NodeType.DATA, label="Memory",
        inputs=[_port("input", PortKind.INPUT)],
        outputs=[_port("output", PortKind.OUTPUT)],
        config=NodeConfig(data_value=1, data_format="structure"),
    )
    code_node = GraphNode(
        id="increment", node_type=NodeType.CODE, label="Increment",
        inputs=[_port("input", PortKind.INPUT)],
        outputs=[_port("output", PortKind.OUTPUT)],
        config=NodeConfig(code="def run(inputs):\n    return {'output': inputs['input'] + 1}\n"),
    )
    graph = Graph(
        nodes=[data_node, code_node],
        edges=[
            GraphEdge(id="read", source_node_id="memory", source_port_id="output",
                      target_node_id="increment", target_port_id="input"),
            GraphEdge(id="write", source_node_id="increment", source_port_id="output",
                      target_node_id="memory", target_port_id="input"),
        ],
    )

    first = await execute_graph(graph)
    assert first.status == ExecutionStatus.SUCCESS
    assert next(r for r in first.node_results if r.node_id == "memory").outputs == {"output": 1}
    assert data_node.config.data_value == 2

    second = await execute_graph(graph)
    assert second.status == ExecutionStatus.SUCCESS
    assert next(r for r in second.node_results if r.node_id == "memory").outputs == {"output": 2}
    assert data_node.config.data_value == 3


# ---------------------------------------------------------------------------
# Extra per-element cases: behavior the minimal per-type fixture above never
# exercises (a non-default config branch), consolidated here instead of a
# standalone single-behavior test file per AGENTS.md's "Tests" section.
# ---------------------------------------------------------------------------

async def test_directory_input_applies_extension_filter(tmp_path):
    """Input (directory mode) config.extra["extensions"] filter (was its own test file)."""
    (tmp_path / "a.md").write_text("md a", encoding="utf-8")
    (tmp_path / "b.md").write_text("md b", encoding="utf-8")
    (tmp_path / "c.txt").write_text("txt c", encoding="utf-8")

    node = GraphNode(
        id="dir_filter", node_type=NodeType.INPUT, label="Dir",
        inputs=[_port("path", PortKind.INPUT, DataType.FILE_PATH)],
        outputs=[_port("files", PortKind.OUTPUT, DataType.FILE_PATH, multi=True),
                 _port("count", PortKind.OUTPUT, DataType.TEXT)],
        config=NodeConfig(value=str(tmp_path), input_mode="directory",
                          select_all_files=True, extensions=".md"),
    )
    result = await NODE_ELEMENTS[NodeType.INPUT].execute(node, {})
    assert sorted(Path(p).name for p in result["files"]) == ["a.md", "b.md"]
    assert result["count"] == 2


async def test_output_element_file_write_honors_json_format(tmp_path):
    """OutputElement's write_mode="file" branch calls write_formatted_file for a
    non-text format (was covered only by raw file_service unit tests)."""
    node = GraphNode(
        id="out_json", node_type=NodeType.OUTPUT, label="Out",
        inputs=[_port("value", PortKind.INPUT, DataType.ANY, multi=True)],
        config=NodeConfig(output_label="Result", write_mode="file", value=str(tmp_path / "result")),
    )
    result = await NODE_ELEMENTS[NodeType.OUTPUT].execute(
        node, {"value": [1, 2, 3]}, effective_formats={"value": "json"},
    )
    written = Path(result["written_path"])
    assert written.suffix == ".json"
    assert json.loads(written.read_text(encoding="utf-8")) == [1, 2, 3]


async def test_output_element_directory_write_honors_binary_and_csv_formats(tmp_path):
    """OutputElement's write_mode="directory" branch honors per-port binary/csv
    formats via write_output_directory (json/text combo already covered in
    test_graph.py's execute_graph-level directory-write test)."""
    raw = b"\x00\x01binarydata"
    encoded = base64.b64encode(raw).decode("ascii")
    node = GraphNode(
        id="out_dir", node_type=NodeType.OUTPUT, label="Out",
        inputs=[_port("blob", PortKind.INPUT, DataType.ANY),
                _port("table", PortKind.INPUT, DataType.ANY)],
        config=NodeConfig(output_label="Result", write_mode="directory", value=str(tmp_path / "out")),
    )
    result = await NODE_ELEMENTS[NodeType.OUTPUT].execute(
        node,
        {"blob": encoded, "table": [{"a": "1"}, {"a": "2"}]},
        effective_formats={"blob": "binary", "table": "csv"},
    )
    written = {Path(p).stem.split("_")[0]: Path(p) for p in result["written_paths"]}
    assert written["blob"].suffix == ".bin"
    assert written["blob"].read_bytes() == raw
    assert written["table"].suffix == ".csv"
    assert "a" in written["table"].read_text(encoding="utf-8")


async def test_output_element_window_mode_compiles_text_window_append():
    """OutputElement's write_mode="window" branch (the former standalone
    TextOutputElement, folded in as a write_mode)."""
    node = GraphNode(
        id="out_window", node_type=NodeType.OUTPUT, label="Out",
        inputs=[_port("value", PortKind.INPUT, DataType.ANY, multi=True)],
        config=NodeConfig(output_label="Shown", write_mode="window"),
    )
    exec_result = await NODE_ELEMENTS[NodeType.OUTPUT].execute(node, {"value": ["a", "b"]})
    assert exec_result == {"value": ["a", "b"]}


# ---------------------------------------------------------------------------
# GUI widget fixtures -- one minimal GuiWidget per GuiWidgetKind.
# ---------------------------------------------------------------------------

def _make_widget(kind: GuiWidgetKind) -> GuiWidget:
    if kind == GuiWidgetKind.INPUT_PICKER:
        return GuiWidget(id="w1", kind=kind, mode="file")
    if kind == GuiWidgetKind.TEXT_IO:
        return GuiWidget(id="w1", kind=kind, mode="both")
    if kind == GuiWidgetKind.PLOT_WINDOW:
        return GuiWidget(id="w1", kind=kind)
    if kind == GuiWidgetKind.IMAGE_VIEW:
        return GuiWidget(id="w1", kind=kind)
    if kind == GuiWidgetKind.TABLE:
        return GuiWidget(id="w1", kind=kind)
    # Page furniture: no ports, no behaviour. Prose carries its role in `mode`.
    if kind == GuiWidgetKind.TEXT:
        return GuiWidget(id="w1", kind=kind, mode="heading", value="Ein Titel")
    if kind in (GuiWidgetKind.DIVIDER, GuiWidgetKind.SPACER):
        return GuiWidget(id="w1", kind=kind)
    raise AssertionError(f"no fixture for {kind}")


def _gui_node_for(widget: GuiWidget, node_id: str = "gui1") -> GraphNode:
    node = GraphNode(id=node_id, node_type=NodeType.GUI, label="GUI", config=NodeConfig(gui_widgets=[widget]))
    sync_gui_node_ports(node)
    return node


@pytest.mark.parametrize("widget_kind, element", list(GUI_WIDGET_ELEMENTS.items()), ids=[k.value for k in GUI_WIDGET_ELEMENTS])
async def test_gui_widget_element_contract(widget_kind: GuiWidgetKind, element, tmp_path, monkeypatch):
    widget = _make_widget(widget_kind)
    gui_node = _gui_node_for(widget)

    # 1. Can be added/removed -- schema smoke test.
    assert len(gui_node.config.gui_widgets) == 1
    empty_node = GraphNode(id="gui_empty", node_type=NodeType.GUI, label="GUI", config=NodeConfig(gui_widgets=[]))
    sync_gui_node_ports(empty_node)
    assert empty_node.config.gui_widgets == [] and empty_node.inputs == [] and empty_node.outputs == []

    # 2. Executed.
    in_id = f"{widget.id}_in"
    inputs = {in_id: ""} if any(p.id == in_id for p in gui_node.inputs) else {}
    await element.execute(widget, inputs)  # asserting only that this doesn't raise

    # 3. Saving and loading works.
    restored = GuiWidget.model_validate_json(widget.model_dump_json())
    assert restored == widget

    # 4. AI can be called -- only input_picker's directory-mode file selector does.
    if widget_kind != GuiWidgetKind.INPUT_PICKER:
        return
    calls = _install_ai_stubs(monkeypatch)
    (tmp_path / "keep.txt").write_text("x", encoding="utf-8")
    ai_widget = GuiWidget(
        id="w_ai", kind=GuiWidgetKind.INPUT_PICKER, mode="directory", value=str(tmp_path),
        select_all_files=False, selector_code="", selector_prompt="pick files",
    )
    await element.execute(ai_widget, {})
    assert len(calls) == 1 and calls[0]["kind"] == "generate_code"
    assert calls[0]["description"] == "pick files"
    assert calls[0]["inputs"] == ["files"]
    assert calls[0]["outputs"] == ["files"]
    # A widget carries no provider of its own any more: it asks for nothing and
    # lets ai_settings resolve whatever this run is configured with, so a
    # deployed graph's AI choice reaches widget-level generation too.
    assert calls[0]["model"] == ""
    assert calls[0]["provider"] == AIProvider.DEFAULT


@pytest.mark.parametrize("node_type, element", list(NODE_ELEMENTS.items()), ids=[t.value for t in NODE_ELEMENTS])
def test_node_element_declares_its_generation(node_type: NodeType, element, tmp_path):
    """An element that authors something declares how it is generated, and vice versa.

    These were five hand-written call sites in the editor, which is why
    `image_view` had an authored field and no way to generate it. Tying the two
    declarations together here is what stops the next one being forgotten.
    """
    node = _make_node(node_type, tmp_path)
    spec = element.generation()
    authored = element.authored_file(node)
    # The direction that matters: text somebody writes must have a way to be
    # written for them. The reverse is not an equivalence -- `generation()` is a
    # property of the element while `authored_file()` looks at one node, and an
    # input node only authors its selector in directory mode (see below).
    if authored is not None:
        assert spec is not None, f"{node_type.value} authors a file and declares no generation"
    if spec is None:
        assert authored is None
        return
    assert spec.kind in ("code", "prompt", "output_format", "data_format")
    # Both fields it names must actually exist, or the button writes into nothing.
    holder = node if spec.prompt_on_node else node.config
    assert hasattr(holder, spec.prompt_field)
    assert hasattr(node.config, spec.target_field)
    # The body it fills is the body the file mechanism reads and writes.
    if authored is not None:
        assert authored.body_field == spec.target_field
    assert spec.guard and spec.success, "a button with no guard/success message is half-declared"
    assert generation_for(node_type.value) is spec or generation_for(node_type.value) == spec


@pytest.mark.parametrize("widget_kind, element", list(GUI_WIDGET_ELEMENTS.items()), ids=[k.value for k in GUI_WIDGET_ELEMENTS])
def test_gui_widget_element_declares_its_generation(widget_kind: GuiWidgetKind, element):
    """Same contract one level down -- a widget is the same object as a node here."""
    widget = _make_widget(widget_kind)
    spec = element.generation()
    authored = element.authored_file(widget)
    assert (spec is not None) == (authored is not None)
    if spec is None:
        return
    assert hasattr(widget, spec.prompt_field)
    assert hasattr(widget, spec.target_field)
    assert authored.body_field == spec.target_field
    # A widget's snippet is never wired as the node is, so it names its own ports.
    assert spec.inputs and spec.outputs
    assert spec.contract, "a snippet contract the model cannot see is a snippet it will get wrong"
    assert generation_for(widget_kind.value) == spec


def test_an_input_node_authors_its_selector_only_in_directory_mode():
    """`generation()` answers for the element, `authored_file()` for one node.

    An input node in text or single-file mode selects nothing, so there is no
    snippet to keep in a file -- while the element still knows how a selector
    would be generated. The editor asks the same question through
    `ElementGeneration.available`.
    """
    element = NODE_ELEMENTS[NodeType.INPUT]
    directory = GraphNode(id="d", node_type=NodeType.INPUT, label="D",
                          config=NodeConfig(input_mode="directory"))
    text = GraphNode(id="t", node_type=NodeType.INPUT, label="T",
                     config=NodeConfig(input_mode="text"))
    assert element.authored_file(directory) is not None
    assert element.authored_file(directory).body_field == element.generation().target_field
    assert element.authored_file(text) is None


def test_the_file_selector_is_declared_once_for_both_levels():
    """`input` (directory mode) and `input_picker` run the identical selector.

    The sentence describing it to the model existed three times -- twice in the
    editor, once as the input node's runtime fallback -- and had already drifted.
    """
    assert NODE_ELEMENTS[NodeType.INPUT].generation() is GUI_WIDGET_ELEMENTS[GuiWidgetKind.INPUT_PICKER].generation()


def test_generation_for_an_unknown_element_is_none():
    assert generation_for("not-an-element") is None
    assert generation_for("") is None


def test_one_example_file_replaces_three_context_fields():
    """A graph written before the rename keeps its attachment, wherever it sat.

    `config_context_file`, `output_context_file` and a widget's
    `example_input_path` were three names for one idea; a node that had a sample
    attached in the Config tab still generated its output format without one.
    """
    graph = Graph.model_validate({
        "nodes": [
            {"id": "a", "node_type": "code", "label": "A", "position": {"x": 0, "y": 0},
             "config": {"config_context_file": "sample.csv"}},
            {"id": "b", "node_type": "code", "label": "B", "position": {"x": 0, "y": 0},
             "config": {"output_context_file": "shape.json"}},
            {"id": "c", "node_type": "gui", "label": "C", "position": {"x": 0, "y": 0},
             "config": {"gui_widgets": [
                 {"id": "w", "kind": "plot_window", "plot_prompt": "chart it",
                  "example_input_path": "bev.csv"}]}},
        ],
        "edges": [],
    })
    by_id = {n.id: n for n in graph.nodes}
    assert by_id["a"].config.example_file == "sample.csv"
    assert by_id["b"].config.example_file == "shape.json"
    widget = by_id["c"].config.gui_widgets[0]
    assert widget.example_file == "bev.csv"
    # plot_prompt was the same field code_prompt is, under a name only one
    # widget kind could use -- which is why image_view never got a prompt.
    assert widget.code_prompt == "chart it"
    assert not hasattr(widget, "plot_prompt")
    assert not hasattr(by_id["a"].config, "config_context_file")


def test_a_widget_size_preset_becomes_the_cells_it_stood_for():
    """`size` was a third way of saying what `w`/`h` already say.

    Three encodings of one layout -- the preset, the widget list's order, and
    w/h -- meant the same widget could be described three times and disagree.
    """
    graph = Graph.model_validate({
        "nodes": [{
            "id": "g", "node_type": "gui", "label": "G", "position": {"x": 0, "y": 0},
            "config": {"gui_widgets": [
                {"id": "small", "kind": "text_io", "size": "small"},
                {"id": "large", "kind": "text_io", "size": "large"},
                # An explicit layout must survive a stale preset: the preset was
                # only ever shorthand for setting these two numbers.
                {"id": "placed", "kind": "text_io", "size": "small", "w": 9, "h": 5},
            ]}},
        ],
        "edges": [],
    })
    by_id = {w.id: w for w in graph.nodes[0].config.gui_widgets}
    assert (by_id["small"].w, by_id["small"].h) == (3, 2)
    assert (by_id["large"].w, by_id["large"].h) == (12, 6)
    assert (by_id["placed"].w, by_id["placed"].h) == (9, 5)
    assert not hasattr(by_id["small"], "size")


# The frontend element file for each element name. Two languages describe one
# element, and the halves have to agree about which fields a button reads and
# writes -- a mismatch is a button that silently writes into nothing.
_FRONTEND_ELEMENT_FILES = {
    "input": "input/inputElement.ts",
    "ai": "ai/aiElement.ts",
    "code": "code/codeElement.ts",
    "data": "data/dataElement.ts",
    "output": "output/outputElement.ts",
    "gui": "gui/guiElement.ts",
    "input_picker": "gui/widgets/input_picker/inputPickerElement.ts",
    "text_io": "gui/widgets/text_io/textIoElement.ts",
    "plot_window": "gui/widgets/plot_window/plotWindowElement.ts",
    "image_view": "gui/widgets/image_view/imageViewElement.ts",
}

_FRONTEND_ELEMENTS_DIR = Path(__file__).parent.parent.parent / "frontend" / "src" / "elements"


def _frontend_generation(element_name: str):
    """The `generation: { ... }` block a frontend element declares, as a dict.

    Read as text rather than executed: this asserts one fact about two languages
    and is not worth a node runtime in the Python test suite.
    """
    source = (_FRONTEND_ELEMENTS_DIR / _FRONTEND_ELEMENT_FILES[element_name]).read_text(encoding="utf-8")
    start = source.find("\n  generation: {")
    if start == -1:
        return None
    block = source[start:source.index("\n  },", start)]
    fields = {}
    for key in ("promptField", "targetField"):
        marker = f"{key}: '"
        at = block.find(marker)
        if at != -1:
            fields[key] = block[at + len(marker):block.index("'", at + len(marker))]
    return fields


@pytest.mark.skipif(not _FRONTEND_ELEMENTS_DIR.is_dir(), reason="frontend not present")
@pytest.mark.parametrize("element_name", sorted(_FRONTEND_ELEMENT_FILES))
def test_both_languages_declare_the_same_generation(element_name: str):
    """The editor's declaration and the engine's must name the same fields.

    They are deliberately not the same object -- the contract sentence, the
    generator kind and the fixed ports stay on the backend and are resolved from
    the element name, so only the two field names are stated twice. This is the
    check that keeps even those two honest.
    """
    backend = generation_for(element_name)
    frontend = _frontend_generation(element_name)
    assert (backend is None) == (frontend is None), (
        f"{element_name}: backend={backend is not None} frontend={frontend is not None}"
    )
    if backend is None:
        return
    assert frontend["promptField"] == backend.prompt_field
    assert frontend["targetField"] == backend.target_field


def test_a_legacy_widget_node_loads_as_a_gui_node():
    """
    `widget` was a `gui` node holding one widget, served by the same element
    registered twice. It is gone as a node type; graphs that used it must still
    load, keeping their widget, their ports and their edges.
    """
    graph = Graph.model_validate({
        "metadata": {"name": "legacy"},
        "nodes": [{
            "id": "w", "node_type": "widget", "label": "Picker",
            "position": {"x": 0, "y": 0}, "inputs": [], "outputs": [],
            "config": {"gui_widgets": [{"id": "p1", "kind": "input_picker", "mode": "file"}]},
        }],
        "edges": [],
    })

    node = graph.nodes[0]
    assert node.node_type == NodeType.GUI
    assert [w.kind for w in node.config.gui_widgets] == [GuiWidgetKind.INPUT_PICKER]
    # Ports are derived from the widget list, so the edge target id survives.
    sync_gui_node_ports(node)
    assert [p.id for p in node.outputs] == ["p1_out"]


def test_widget_is_no_longer_a_node_type():
    assert not hasattr(NodeType, "WIDGET")
    assert "widget" not in {t.value for t in NodeType}


def test_directory_selection_settings_move_out_of_the_untyped_bag():
    """`extra` was the DSL's passthrough, and two real settings were hiding in it.

    A `GuiWidget` declared `recursive`/`extensions` as fields while the `input`
    node -- the same behaviour one level up -- kept them in `extra`, so one
    contract was described two ways. Anything else in `extra` is untouched.
    """
    graph = Graph.model_validate({
        "nodes": [{
            "id": "d", "node_type": "input", "label": "Dir", "position": {"x": 0, "y": 0},
            "config": {
                "input_mode": "directory",
                "extra": {"recursive": True, "extensions": ".md, .txt", "mine": "kept"},
            },
        }],
        "edges": [],
    })
    config = graph.nodes[0].config
    assert config.recursive is True
    assert config.extensions == ".md, .txt"
    assert config.extra == {"mine": "kept"}


# ---------------------------------------------------------------------------
# Which config fields does an element own?
# ---------------------------------------------------------------------------
#
# `NodeConfig` is one flat model of ~30 fields shared by every node type, so the
# DSL never said which of them a given element has any business with -- an
# `output` node is created carrying `selector_code`, `system_prompt` and
# `gui_widgets`, and uses two fields. That silence is why `recursive` and
# `extensions` could live in `extra` on the input node while being real fields
# on the widget doing the identical job.
#
# `NodeElement.config_fields` answers the question; this holds each element to
# its answer. It does not split the wire format: graphs stay flat, and old ones
# load unchanged.

_ELEMENT_SOURCES = {
    NodeType.INPUT:  "input/input_element.py",
    NodeType.AI:     "ai/ai_element.py",
    NodeType.CODE:   "code/code_element.py",
    NodeType.DATA:   "data/data_element.py",
    NodeType.OUTPUT: "output/output_element.py",
    NodeType.GUI:    "gui/gui_element.py",
}


def _config_fields_read_by(source: str) -> set:
    """Every NodeConfig field name the source actually reads off a config.

    Comments are stripped first, so the prose explaining a field never counts as
    a use of it -- otherwise every declaration would justify itself.
    """
    import re
    body = "\n".join(line.split("#")[0] for line in source.splitlines())
    known = set(NodeConfig.model_fields)
    return {
        match.group(1)
        for match in re.finditer(r"\b(?:cfg|config|node\.config)\.(\w+)", body)
        if match.group(1) in known
    }


@pytest.mark.parametrize("node_type", sorted(_ELEMENT_SOURCES, key=lambda t: t.value))
def test_every_config_field_an_element_reads_is_declared(node_type):
    from app.elements.base import SHARED_CONFIG_FIELDS

    path = Path(__file__).parent.parent / "app" / "elements" / _ELEMENT_SOURCES[node_type]
    used = _config_fields_read_by(path.read_text(encoding="utf-8"))
    declared = set(NODE_ELEMENTS[node_type].config_fields) | set(SHARED_CONFIG_FIELDS)

    undeclared = used - declared
    assert not undeclared, (
        f"{node_type.value} reads {sorted(undeclared)} but does not declare them in "
        f"config_fields. Either add them, or stop reading another element's field."
    )


@pytest.mark.parametrize("node_type", sorted(_ELEMENT_SOURCES, key=lambda t: t.value))
def test_declared_config_fields_exist_in_the_dsl(node_type):
    """A declaration naming a field that no longer exists is worse than none:
    it reads as a guarantee and checks nothing."""
    unknown = set(NODE_ELEMENTS[node_type].config_fields) - set(NodeConfig.model_fields)
    assert not unknown, f"{node_type.value} declares fields that are not in NodeConfig: {sorted(unknown)}"


def test_no_element_claims_a_shared_field_as_its_own():
    """`example_file`/`code_file`/`extra` belong to every element by contract, so
    naming one locally suggests a private meaning it does not have."""
    from app.elements.base import SHARED_CONFIG_FIELDS

    for node_type, element in NODE_ELEMENTS.items():
        overlap = set(element.config_fields) & set(SHARED_CONFIG_FIELDS)
        assert not overlap, f"{node_type.value} redeclares shared field(s) {sorted(overlap)}"


def test_the_output_node_owns_almost_nothing():
    """The concrete symptom this contract exists for.

    An output node writes a value somewhere. It was constructed carrying every
    AI, code, data and gui field in the DSL, and nothing said otherwise.
    """
    assert len(NODE_ELEMENTS[NodeType.OUTPUT].config_fields) <= 4
    assert len(NodeConfig.model_fields) > 25


@pytest.mark.skipif(not _FRONTEND_ELEMENTS_DIR.is_dir(), reason="frontend not present")
@pytest.mark.parametrize("node_type", sorted(NODE_ELEMENTS, key=lambda t: t.value))
def test_both_languages_agree_on_which_nodes_are_memory(node_type):
    """Memory must not mean two different things depending on who is asked.

    The executor excludes an edge into a memory node from topological ordering;
    the editor persists the settled value for the next run. Both used to decide
    with their own hard-coded `(data, gui)` list -- two lists, one rule, and no
    check that they matched.
    """
    source = (_FRONTEND_ELEMENTS_DIR / _FRONTEND_ELEMENT_FILES[node_type.value]).read_text(encoding="utf-8")
    frontend_says = "isMemory: true" in source
    assert frontend_says == NODE_ELEMENTS[node_type].is_memory, (
        f"{node_type.value}: backend is_memory={NODE_ELEMENTS[node_type].is_memory}, "
        f"frontend isMemory={frontend_says}"
    )


def test_a_memory_element_can_store_what_settles_into_it():
    """`is_memory` without somewhere to put the value is a promise with no
    implementation: the frontend half must also declare `settleMemoryValue`."""
    for node_type, element in NODE_ELEMENTS.items():
        if not element.is_memory:
            continue
        source = (_FRONTEND_ELEMENTS_DIR / _FRONTEND_ELEMENT_FILES[node_type.value]).read_text(encoding="utf-8")
        assert "settleMemoryValue" in source, (
            f"{node_type.value} is a memory element but declares no settleMemoryValue"
        )


# ---------------------------------------------------------------------------
# The shared snippet runner
# ---------------------------------------------------------------------------
#
# Four elements wrote out the same four steps -- find the body, find the
# language, call the sandbox, decide what a failure costs -- and the copies had
# begun to disagree (the selector's contract sentence existed twice, in two
# wordings). `Element.run_snippet` is those steps, once.


async def test_a_display_widget_survives_its_own_broken_transform():
    """Cosmetic by declaration, not by a try/except in the composite.

    A plot whose transform raises must show the reason and leave its sibling
    widgets' outputs intact -- a failure here has no downstream port to corrupt.
    """
    from app.elements.gui.gui_element import apply_display_transform

    widget = GuiWidget(id="w", kind=GuiWidgetKind.PLOT_WINDOW, label="Chart",
                       code="def run(inputs):\n    raise ValueError('boom')\n")
    shown = await apply_display_transform(widget, [1, 2, 3])
    assert isinstance(shown, str) and "transform failed" in shown and "Chart" in shown


async def test_an_empty_transform_passes_the_value_through():
    from app.elements.gui.gui_element import apply_display_transform

    widget = GuiWidget(id="w", kind=GuiWidgetKind.PLOT_WINDOW, label="Chart", code="")
    assert await apply_display_transform(widget, [1, 2, 3]) == [1, 2, 3]


async def test_a_code_node_with_no_code_says_so():
    """It used to reach the sandbox anyway and come back as a NameError out of a
    subprocess, which named neither the node nor the actual problem."""
    node = GraphNode(id="c", node_type=NodeType.CODE, label="Empty",
                     outputs=[_port("output", PortKind.OUTPUT)], config=NodeConfig(code=""))
    with pytest.raises(RuntimeError, match="no code"):
        await NODE_ELEMENTS[NodeType.CODE].execute(node, {})


def test_the_two_display_widgets_share_one_implementation():
    """plot_window and image_view had byte-identical ports/execute/authored_file.

    If a future widget kind reimplements them instead of inheriting, this is the
    check that notices.
    """
    from app.elements.base import DisplayWidget

    for kind in (GuiWidgetKind.PLOT_WINDOW, GuiWidgetKind.IMAGE_VIEW):
        element = GUI_WIDGET_ELEMENTS[kind]
        assert isinstance(element, DisplayWidget)
        assert type(element).ports is DisplayWidget.ports
        assert type(element).authored_file is DisplayWidget.authored_file
        assert element.snippet_failure == "cosmetic"
