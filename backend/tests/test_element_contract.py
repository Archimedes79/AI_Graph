"""
Consolidated element-contract test.

Walks every registered `NodeElement` (`elements.registry.NODE_ELEMENTS`) and
`GuiWidgetElement` (`elements.registry.GUI_WIDGET_ELEMENTS`) and asserts the
handful of universal properties every element must satisfy -- see AGENTS.md's
"Object-oriented element contract". This REPLACES ad-hoc per-element unit
tests: when adding a new NodeType/GuiWidgetKind, extend the per-type tables
below instead of adding a new test file.

The `execute()` vs `compile()` consistency check (#6) is the one that would
have caught this session's `text_io`/`input` bugs -- it actually runs each
element's `compile()`-emitted lines through a small exec harness built from
deploy_service.py's own helper snippets (not a reimplementation of them) and
compares the result against a live `execute()` call for the same inputs.
"""

from __future__ import annotations

import sys
import textwrap
from pathlib import Path
from typing import Any, Dict, List, Tuple

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
from app.services import deploy_service as ds  # noqa: E402
from app.services.batching import batch_inputs, merge_batch_outputs  # noqa: E402
from app.services.deploy.shared import DEFERRED_LITERAL  # noqa: E402

CODE_ECHO = "def run(inputs):\n    return {'output': inputs.get('input', '')}\n"


# ---------------------------------------------------------------------------
# Exec harness for check #6 -- embeds deploy_service.py's own helper source
# blocks (never a reimplementation of them) so a compiled node's lines can run
# standalone, exactly the way generate_runner_script() would nest them.
# ---------------------------------------------------------------------------

def _harness_namespace(*, needs_files: bool = False, needs_code_runner: bool = False, needs_ai: bool = False) -> Dict[str, Any]:
    import asyncio
    import json
    import os
    import sys as _sys
    import tempfile

    ns: Dict[str, Any] = {"Path": Path, "asyncio": asyncio, "json": json, "os": os, "sys": _sys, "tempfile": tempfile}
    if needs_files:
        exec(ds._FILE_HELPERS, ns)
    if needs_code_runner or needs_ai:
        exec(ds._BATCH_HELPERS, ns)
    if needs_code_runner:
        exec(ds._CODE_RUNNER_HELPER, ns)
    if needs_ai:
        exec(ds._AI_HELPER, ns)
    return ns


async def _run_compiled(element, node: GraphNode, sources, node_map, *, resolved=None, **flags) -> Any:
    """Exec *element*'s `compile()` output for *node* and return `results[node.id]`."""
    ns = _harness_namespace(**flags)
    ns["_resolved"] = resolved or {}
    ns["results"] = {}
    ns["_text_windows"] = []
    lines = element.compile(node, sources, node_map)
    body = textwrap.indent("\n".join(lines) or "pass", "    ")
    exec(compile(f"async def __run():\n{body}\n", "<compiled-node>", "exec"), ns)
    await ns["__run"]()
    return ns["results"][node.id]


def _literal_sources(node_id: str, inputs: Dict[str, Any]) -> Dict[Tuple[str, str], List[Tuple[str, str]]]:
    """Fake `sources` wiring each of *inputs*'s keys to a literal value, reusing the
    same DEFERRED_LITERAL sentinel deploy_service uses for a t+1 edge's initial
    value -- lets compile() see the same values execute() receives without a real
    upstream node."""
    return {(node_id, port_id): [(DEFERRED_LITERAL, repr(value))] for port_id, value in inputs.items()}


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
    if node_type == NodeType.MERGE:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          inputs=[_port("inputs", PortKind.INPUT, DataType.ANY, multi=True)],
                          outputs=[_port("output", PortKind.OUTPUT, DataType.TEXT)],
                          config=NodeConfig(separator="\n"))
    if node_type == NodeType.SPLIT:
        return GraphNode(id=nid, node_type=node_type, label="L",
                          inputs=[_port("input", PortKind.INPUT, DataType.TEXT, required=True)],
                          outputs=[_port("items", PortKind.OUTPUT, DataType.LIST, multi=True),
                                   _port("count", PortKind.OUTPUT, DataType.TEXT)],
                          config=NodeConfig(separator=","))
    if node_type == NodeType.GUI:
        node = GraphNode(id=nid, node_type=node_type, label="L", config=NodeConfig(gui_widgets=[]))
        sync_gui_node_ports(node)
        return node
    raise AssertionError(f"no fixture for {node_type}")


# Elements whose execute()/compile() plausibly call out to an AI model.
AI_CAPABLE_NODE_TYPES = {NodeType.AI, NodeType.DIRECTORY_INPUT, NodeType.INPUT}

# Elements covered by check #6 (execute vs compile consistency). NodeType.AI is
# excluded: its compiled helper (`_ai_complete`) calls httpx directly with no
# ai_service indirection to monkeypatch. NodeType.GUI is excluded: it is a pure
# composite whose behavior is exactly its widgets' -- already exercised below.
CODE_CONVERSION_NODE_TYPES = {
    NodeType.TEXT_INPUT, NodeType.INPUT, NodeType.FILE_INPUT, NodeType.DIRECTORY_INPUT,
    NodeType.MERGE, NodeType.SPLIT, NodeType.OUTPUT, NodeType.TEXT_OUTPUT, NodeType.CODE,
}


async def _assert_ai_call_path(node_type: NodeType, element, tmp_path: Path, monkeypatch) -> None:
    if node_type not in AI_CAPABLE_NODE_TYPES:
        return  # merge/split/output/... never call AI -- nothing to verify.
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


async def _assert_code_conversion(node_type: NodeType, element, node: GraphNode) -> None:
    if node_type not in CODE_CONVERSION_NODE_TYPES:
        return

    uses_config_value_only = node_type in (
        NodeType.TEXT_INPUT, NodeType.INPUT, NodeType.FILE_INPUT, NodeType.DIRECTORY_INPUT,
    )
    if node_type == NodeType.MERGE:
        inputs: Dict[str, Any] = {"inputs": ["a", "b"]}
    elif node_type == NodeType.SPLIT:
        inputs = {"input": "a,b,c"}
    elif node_type in (NodeType.OUTPUT, NodeType.TEXT_OUTPUT):
        inputs = {"value": ["hello", "world"]}
    elif node_type == NodeType.CODE:
        inputs = {"input": ["x", "y"]}
    else:
        inputs = {}

    if node_type == NodeType.CODE and node.config.batch_mode == "per_item":
        # graph_executor.py batches CODE/AI nodes *outside* the element (one execute()
        # call per item); compile() bakes the equivalent batching in directly. Mirror
        # that split here instead of calling execute() with the raw multi-port list.
        items = batch_inputs(node, inputs)
        exec_result = merge_batch_outputs(node, [await element.execute(node, item) for item in items])
    else:
        exec_result = await element.execute(node, dict(inputs))

    sources = {} if uses_config_value_only else _literal_sources(node.id, inputs)
    needs_files = node_type in (NodeType.FILE_INPUT, NodeType.DIRECTORY_INPUT) or (
        node_type == NodeType.INPUT and node.config.input_mode in ("file", "directory")
    )
    compiled_result = await _run_compiled(
        element, node, sources, {}, needs_files=needs_files, needs_code_runner=(node_type == NodeType.CODE),
    )
    assert compiled_result == exec_result


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

    # 3. Code can be generated.
    compiled = element.compile(node, {}, {})
    assert isinstance(compiled, list)
    assert all(isinstance(line, str) for line in compiled)

    # 4. Saving and loading works.
    restored = GraphNode.model_validate_json(node.model_dump_json())
    assert restored == node

    # 5. AI can be called (only for AI-capable node types; no-op otherwise).
    await _assert_ai_call_path(node_type, element, tmp_path, monkeypatch)

    # 6. Code conversion: execute() vs compile() consistency (no-op if not covered).
    await _assert_code_conversion(node_type, element, node)


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


# Widget kinds covered by check #6. plot_window is excluded: it is display-only
# (no output port), so its compiled effect only shows up in `_inputs`, which
# our harness (like the real script) never surfaces outside the node body --
# there is no meaningful standalone value to diff.
WIDGET_CODE_CONVERSION_KINDS = {GuiWidgetKind.INPUT_PICKER, GuiWidgetKind.TEXT_IO}


async def _assert_widget_code_conversion(widget_kind: GuiWidgetKind, element, tmp_path: Path) -> None:
    if widget_kind not in WIDGET_CODE_CONVERSION_KINDS:
        return

    if widget_kind == GuiWidgetKind.INPUT_PICKER:
        f = tmp_path / "picked.txt"
        f.write_text("x", encoding="utf-8")
        widget = GuiWidget(id="w1", kind=widget_kind, mode="file", value=str(f))
        inputs: Dict[str, Any] = {}
        needs_files = True
    else:  # TEXT_IO
        widget = GuiWidget(id="w1", kind=widget_kind, mode="both", value="")
        inputs = {"w1_in": "incoming value"}
        needs_files = False

    node = _gui_node_for(widget, node_id="gui_check6")
    exec_result = element.execute(widget, dict(inputs))

    gui_element = NODE_ELEMENTS[NodeType.GUI]
    sources = _literal_sources(node.id, inputs)
    compiled = await _run_compiled(gui_element, node, sources, {}, needs_files=needs_files)

    assert compiled.get(f"{widget.id}_out") == exec_result


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

    # 3. Code can be generated.
    compiled = element.compile(gui_node, widget)
    assert isinstance(compiled, list)
    assert all(isinstance(line, str) for line in compiled)

    # 4. Saving and loading works.
    restored = GuiWidget.model_validate_json(widget.model_dump_json())
    assert restored == widget

    # 5. AI can be called -- no GuiWidgetKind currently triggers an AI call, so nothing to verify.

    # 6. Code conversion: execute() vs compile() consistency (no-op if not covered).
    await _assert_widget_code_conversion(widget_kind, element, tmp_path)
