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

from app.elements.registry import GUI_WIDGET_ELEMENTS, NODE_ELEMENTS  # noqa: E402
from app.models.graph import (  # noqa: E402
    AIProvider,
    DataType,
    Graph,
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

    async def stub_complete(prompt, system="", model="llama3", temperature=0.7, provider=AIProvider.OLLAMA):
        calls.append({"kind": "complete", "prompt": prompt, "system": system, "model": model,
                      "temperature": temperature, "provider": provider})
        return "STUB_COMPLETION"

    async def stub_generate_code(description, language="python", context="", inputs=None, outputs=None,
                                  model="llama3", provider=AIProvider.OLLAMA):
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
    if node_type == NodeType.TEXT_INPUT:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          outputs=[_port("output", PortKind.OUTPUT, DataType.TEXT)],
                          config=NodeConfig(value="hello"))
    if node_type == NodeType.INPUT:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          outputs=[_port("output", PortKind.OUTPUT, DataType.TEXT)],
                          config=NodeConfig(value="hello", input_mode="text"))
    if node_type == NodeType.FILE_INPUT:
        f = tmp_path / "sample.txt"
        f.write_text("sample content", encoding="utf-8")
        return GraphNode(id=nid, node_type=node_type, label="L",
                          inputs=[_port("path", PortKind.INPUT, DataType.FILE_PATH)],
                          outputs=[_port("content", PortKind.OUTPUT, DataType.TEXT),
                                   _port("path", PortKind.OUTPUT, DataType.FILE_PATH)],
                          config=NodeConfig(value=str(f)))
    if node_type == NodeType.DIRECTORY_INPUT:
        (tmp_path / "a.txt").write_text("a", encoding="utf-8")
        return GraphNode(id=nid, node_type=node_type, label="L",
                          inputs=[_port("path", PortKind.INPUT, DataType.FILE_PATH)],
                          outputs=[_port("files", PortKind.OUTPUT, DataType.FILE_PATH, multi=True),
                                   _port("count", PortKind.OUTPUT, DataType.TEXT)],
                          config=NodeConfig(value=str(tmp_path), select_all_files=True))
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
    if node_type == NodeType.OUTPUT:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          inputs=[_port("value", PortKind.INPUT, DataType.ANY, multi=True)],
                          config=NodeConfig(output_label="Result"))
    if node_type == NodeType.TEXT_OUTPUT:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          inputs=[_port("value", PortKind.INPUT, DataType.ANY, multi=True)],
                          config=NodeConfig(output_label="Text"))
    if node_type == NodeType.GUI:
        node = GraphNode(id=nid, node_type=node_type, label="L", config=NodeConfig(gui_widgets=[]))
        sync_gui_node_ports(node)
        return node
    raise AssertionError(f"no fixture for {node_type}")


# Elements whose execute() plausibly calls out to an AI model.
AI_CAPABLE_NODE_TYPES = {NodeType.AI, NodeType.DIRECTORY_INPUT, NodeType.INPUT}


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

    # NodeType.DIRECTORY_INPUT / NodeType.INPUT in directory mode with a selector_prompt.
    (tmp_path / "keep.txt").write_text("x", encoding="utf-8")
    node = GraphNode(
        id="dir_ai_check", node_type=node_type, label="Dir",
        inputs=[_port("path", PortKind.INPUT, DataType.FILE_PATH)],
        outputs=[_port("files", PortKind.OUTPUT, DataType.FILE_PATH, multi=True),
                 _port("count", PortKind.OUTPUT, DataType.TEXT)],
        config=NodeConfig(
            value=str(tmp_path), select_all_files=False, selector_code="",
            selector_prompt="pick files", ai_model="m2", ai_provider=AIProvider.OLLAMA,
            input_mode="directory",
        ),
    )
    await element.execute(node, {})
    assert len(calls) == 1 and calls[0]["kind"] == "generate_code"
    assert calls[0]["description"] == "pick files"
    assert calls[0]["inputs"] == ["files"]
    assert calls[0]["outputs"] == ["files"]
    assert calls[0]["model"] == "m2"
    assert calls[0]["provider"] == AIProvider.OLLAMA


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


# ---------------------------------------------------------------------------
# Extra per-element cases: behavior the minimal per-type fixture above never
# exercises (a non-default config branch), consolidated here instead of a
# standalone single-behavior test file per AGENTS.md's "Tests" section.
# ---------------------------------------------------------------------------

async def test_directory_input_applies_extension_filter(tmp_path):
    """DirectoryInput's config.extra["extensions"] filter (was its own test file)."""
    (tmp_path / "a.md").write_text("md a", encoding="utf-8")
    (tmp_path / "b.md").write_text("md b", encoding="utf-8")
    (tmp_path / "c.txt").write_text("txt c", encoding="utf-8")

    node = GraphNode(
        id="dir_filter", node_type=NodeType.DIRECTORY_INPUT, label="Dir",
        inputs=[_port("path", PortKind.INPUT, DataType.FILE_PATH)],
        outputs=[_port("files", PortKind.OUTPUT, DataType.FILE_PATH, multi=True),
                 _port("count", PortKind.OUTPUT, DataType.TEXT)],
        config=NodeConfig(value=str(tmp_path), select_all_files=True, extra={"extensions": ".md"}),
    )
    result = await NODE_ELEMENTS[NodeType.DIRECTORY_INPUT].execute(node, {})
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
    TextOutputElement, folded in as a write_mode) -- covers both an explicit
    `output` node and the legacy `text_output` node_type alias, which forces
    "window" regardless of its config's write_mode."""
    node = GraphNode(
        id="out_window", node_type=NodeType.OUTPUT, label="Out",
        inputs=[_port("value", PortKind.INPUT, DataType.ANY, multi=True)],
        config=NodeConfig(output_label="Shown", write_mode="window"),
    )
    exec_result = await NODE_ELEMENTS[NodeType.OUTPUT].execute(node, {"value": ["a", "b"]})
    assert exec_result == {"value": ["a", "b"]}

    legacy_node = GraphNode(
        id="legacy_text_output", node_type=NodeType.TEXT_OUTPUT, label="Legacy",
        inputs=[_port("value", PortKind.INPUT, DataType.ANY, multi=True)],
        config=NodeConfig(output_label="Shown"),  # write_mode left at its "none" default
    )
    legacy_exec_result = await NODE_ELEMENTS[NodeType.TEXT_OUTPUT].execute(legacy_node, {"value": ["a", "b"]})
    assert legacy_exec_result == exec_result


# ---------------------------------------------------------------------------
# GUI widget fixtures -- one minimal GuiWidget per GuiWidgetKind.
# ---------------------------------------------------------------------------

def _make_widget(kind: GuiWidgetKind) -> GuiWidget:
    if kind == GuiWidgetKind.INPUT_PICKER:
        return GuiWidget(id="w1", kind=kind, mode="file")
    if kind in (GuiWidgetKind.FILE_OPEN, GuiWidgetKind.DIRECTORY_OPEN):
        return GuiWidget(id="w1", kind=kind)  # legacy: mode derived from kind
    if kind == GuiWidgetKind.TEXT_IO:
        return GuiWidget(id="w1", kind=kind, mode="both")
    if kind in (GuiWidgetKind.TEXT_WINDOW, GuiWidgetKind.CHAT_WINDOW):
        return GuiWidget(id="w1", kind=kind)  # legacy: mode defaults to "both"
    if kind == GuiWidgetKind.PLOT_WINDOW:
        return GuiWidget(id="w1", kind=kind)
    raise AssertionError(f"no fixture for {kind}")


def _gui_node_for(widget: GuiWidget, node_id: str = "gui1") -> GraphNode:
    node = GraphNode(id=node_id, node_type=NodeType.GUI, label="GUI", config=NodeConfig(gui_widgets=[widget]))
    sync_gui_node_ports(node)
    return node


@pytest.mark.parametrize("widget_kind, element", list(GUI_WIDGET_ELEMENTS.items()), ids=[k.value for k in GUI_WIDGET_ELEMENTS])
async def test_gui_widget_element_contract(widget_kind: GuiWidgetKind, element, tmp_path):
    widget = _make_widget(widget_kind)
    gui_node = _gui_node_for(widget)

    # 1. Can be added/removed -- schema smoke test.
    assert len(gui_node.config.gui_widgets) == 1
    empty_node = GraphNode(id="gui_empty", node_type=NodeType.GUI, label="GUI", config=NodeConfig(gui_widgets=[]))
    sync_gui_node_ports(empty_node)
    assert empty_node.config.gui_widgets == [] and empty_node.inputs == [] and empty_node.outputs == []

    # 2. Executed (widget execute() is sync, unlike NodeElement.execute()).
    in_id = f"{widget.id}_in"
    inputs = {in_id: ""} if any(p.id == in_id for p in gui_node.inputs) else {}
    element.execute(widget, inputs)  # asserting only that this doesn't raise

    # 3. Saving and loading works.
    restored = GuiWidget.model_validate_json(widget.model_dump_json())
    assert restored == widget

    # 4. AI can be called -- no GuiWidgetKind currently triggers an AI call, so nothing to verify.
