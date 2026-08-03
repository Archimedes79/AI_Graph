"""
Tests for GUI-node widget execution and runtime-requirement handling.

Widget-targeting convention for `apply_runtime_values`: a key of
`"{node_id}::{widget_id}"` sets that GUI node's widget `value`; a plain
`node_id` key keeps writing `node.config.value` for every other node type.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import (  # noqa: E402
    DataType,
    ExecutionStatus,
    Graph,
    GraphEdge,
    GraphMetadata,
    GraphNode,
    GuiWidget,
    GuiWidgetKind,
    NodeConfig,
    NodeType,
    Port,
    PortKind,
    sync_gui_node_ports,
)
from app.services.graph_executor import (  # noqa: E402
    apply_runtime_values,
    execute_graph,
    get_runtime_requirements,
)

CODE_ECHO_CONTENT = (
    "def run(inputs):\n"
    "    return {'content': inputs.get('path', '')}\n"
)

CODE_COUNT_FILES = (
    "def run(inputs):\n"
    "    return {'count': len(inputs.get('files') or [])}\n"
)


def _gui_node(node_id: str, widgets: list[GuiWidget]) -> GraphNode:
    node = GraphNode(
        id=node_id, node_type=NodeType.GUI, label="GUI",
        config=NodeConfig(gui_widgets=widgets),
    )
    sync_gui_node_ports(node)
    return node


@pytest.mark.asyncio
async def test_file_open_widget_feeds_downstream_code_node_content(tmp_path):
    fixture = tmp_path / "note.md"
    fixture.write_text("hello from gui\n", encoding="utf-8")

    gui = _gui_node("gui", [GuiWidget(id="w1", kind=GuiWidgetKind.INPUT_PICKER, mode="file", value=str(fixture))])
    code = GraphNode(
        id="code", node_type=NodeType.CODE, label="EchoContent",
        inputs=[Port(id="path", name="Path", kind=PortKind.INPUT, data_type=DataType.FILE_PATH)],
        outputs=[Port(id="content", name="Content", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(code=CODE_ECHO_CONTENT, read_file_inputs=True),
    )
    graph = Graph(
        metadata=GraphMetadata(name="FileOpen->Code"),
        nodes=[gui, code],
        edges=[GraphEdge(id="e1", source_node_id="gui", source_port_id="w1_out",
                          target_node_id="code", target_port_id="path")],
    )

    result = await execute_graph(graph)
    assert result.status == "success"

    gui_result = next(r for r in result.node_results if r.node_id == "gui")
    assert gui_result.outputs["w1_out"] == str(fixture.resolve())

    code_result = next(r for r in result.node_results if r.node_id == "code")
    assert code_result.outputs["content"] == "hello from gui\n"


@pytest.mark.asyncio
async def test_directory_open_widget_lists_files_with_extension_filter(tmp_path):
    (tmp_path / "keep.md").write_text("a", encoding="utf-8")
    (tmp_path / "skip.txt").write_text("b", encoding="utf-8")

    gui = _gui_node(
        "gui",
        [GuiWidget(id="w1", kind=GuiWidgetKind.INPUT_PICKER, mode="directory", value=str(tmp_path), extensions=".md")],
    )
    code = GraphNode(
        id="code", node_type=NodeType.CODE, label="CountFiles",
        inputs=[Port(id="files", name="Files", kind=PortKind.INPUT, data_type=DataType.FILE_PATH, multi=True)],
        outputs=[Port(id="count", name="Count", kind=PortKind.OUTPUT, data_type=DataType.JSON)],
        config=NodeConfig(code=CODE_COUNT_FILES, batch_mode="whole_list"),
    )
    graph = Graph(
        metadata=GraphMetadata(name="DirOpen->Code"),
        nodes=[gui, code],
        edges=[GraphEdge(id="e1", source_node_id="gui", source_port_id="w1_out",
                          target_node_id="code", target_port_id="files")],
    )

    result = await execute_graph(graph)
    assert result.status == "success"

    gui_result = next(r for r in result.node_results if r.node_id == "gui")
    assert [Path(p).name for p in gui_result.outputs["w1_out"]] == ["keep.md"]

    code_result = next(r for r in result.node_results if r.node_id == "code")
    assert code_result.outputs["count"] == 1


@pytest.mark.asyncio
async def test_text_window_widget_passthrough():
    gui = _gui_node("gui", [GuiWidget(id="w1", kind=GuiWidgetKind.TEXT_IO, value="default text")])
    graph = Graph(metadata=GraphMetadata(name="TextWindow"), nodes=[gui], edges=[])

    result = await execute_graph(graph)
    assert result.status == "success"
    gui_result = next(r for r in result.node_results if r.node_id == "gui")
    assert gui_result.outputs["w1_out"] == "default text"


@pytest.mark.asyncio
async def test_text_window_widget_prefers_widget_value_over_wired_input():
    """With the unified text_io element, mode='both': widget.value wins when non-empty."""
    upstream = GraphNode(
        id="src", node_type=NodeType.INPUT, label="Src",
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(value="wired value"),
    )
    gui = _gui_node("gui", [GuiWidget(id="w1", kind=GuiWidgetKind.TEXT_IO, value="default text")])
    graph = Graph(
        metadata=GraphMetadata(name="TextWindow wired"),
        nodes=[upstream, gui],
        edges=[GraphEdge(id="e1", source_node_id="src", source_port_id="output",
                          target_node_id="gui", target_port_id="w1_in")],
    )

    result = await execute_graph(graph)
    assert result.status == "success"
    gui_result = next(r for r in result.node_results if r.node_id == "gui")
    # widget.value is non-empty → wins over wired input
    assert gui_result.outputs["w1_out"] == "default text"


@pytest.mark.asyncio
async def test_chat_window_widget_passthrough_prefers_own_value():
    gui = _gui_node("gui", [GuiWidget(id="w1", kind=GuiWidgetKind.TEXT_IO, value="typed message")])
    graph = Graph(metadata=GraphMetadata(name="ChatWindow"), nodes=[gui], edges=[])

    result = await execute_graph(graph)
    assert result.status == "success"
    gui_result = next(r for r in result.node_results if r.node_id == "gui")
    assert gui_result.outputs["w1_out"] == "typed message"


@pytest.mark.asyncio
async def test_chat_window_widget_falls_back_to_joined_wired_input():
    upstream = GraphNode(
        id="src", node_type=NodeType.CODE, label="Src",
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True)],
        config=NodeConfig(code="def run(inputs):\n    return {'output': ['hi', 'there']}\n"),
    )
    gui = _gui_node("gui", [GuiWidget(id="w1", kind=GuiWidgetKind.TEXT_IO)])
    graph = Graph(
        metadata=GraphMetadata(name="ChatWindow fallback"),
        nodes=[upstream, gui],
        edges=[GraphEdge(id="e1", source_node_id="src", source_port_id="output",
                          target_node_id="gui", target_port_id="w1_in")],
    )

    result = await execute_graph(graph)
    assert result.status == "success"
    gui_result = next(r for r in result.node_results if r.node_id == "gui")
    assert gui_result.outputs["w1_out"] == "hi\nthere"


def test_runtime_requirements_and_apply_round_trip_for_empty_file_open_widget(tmp_path):
    gui = _gui_node("gui", [
        GuiWidget(id="w1", kind=GuiWidgetKind.INPUT_PICKER, mode="file"),
        GuiWidget(id="w2", kind=GuiWidgetKind.INPUT_PICKER, mode="directory", value=str(tmp_path)),
    ])
    graph = Graph(metadata=GraphMetadata(name="Requirements"), nodes=[gui], edges=[])

    requirements = get_runtime_requirements(graph)
    assert len(requirements) == 1
    req = requirements[0]
    assert req.node_id == "gui"
    assert req.widget_id == "w1"
    assert req.kind == "file"
    assert req.direction == "input"

    fixture = tmp_path / "resolved.md"
    fixture.write_text("content", encoding="utf-8")
    apply_runtime_values(graph, {f"{req.node_id}::{req.widget_id}": str(fixture)})

    widget = next(w for w in graph.nodes[0].config.gui_widgets if w.id == "w1")
    assert widget.value == str(fixture)

    # Widget with a preset value never becomes a requirement.
    assert not any(r.widget_id == "w2" for r in requirements)


def test_apply_runtime_values_keeps_plain_node_id_behavior_unchanged():
    node = GraphNode(
        id="input", node_type=NodeType.INPUT, label="Input",
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(),
    )
    graph = Graph(metadata=GraphMetadata(name="Plain"), nodes=[node], edges=[])

    apply_runtime_values(graph, {"input": "plain value"})

    assert graph.nodes[0].config.value == "plain value"


PLOT_TRANSFORM_JSON = (
    "def run(inputs):\n"
    "    import json\n"
    "    raw = inputs.get('value')\n"
    "    data = json.loads(raw) if isinstance(raw, str) else raw\n"
    "    return {'value': [{'x': i, 'y': v} for i, v in enumerate(data)]}\n"
)

PLOT_TRANSFORM_BROKEN = (
    "def run(inputs):\n"
    "    raise ValueError('boom')\n"
)


def _plot_graph(widget: GuiWidget) -> Graph:
    upstream = GraphNode(
        id="src", node_type=NodeType.INPUT, label="Src",
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(value="[1, 2, 3]"),
    )
    gui = _gui_node("gui", [widget])
    return Graph(
        metadata=GraphMetadata(name="PlotWindow"),
        nodes=[upstream, gui],
        edges=[GraphEdge(id="e1", source_node_id="src", source_port_id="output",
                          target_node_id="gui", target_port_id="w1_in")],
    )


@pytest.mark.asyncio
async def test_plot_window_widget_empty_code_passes_through_raw_value():
    graph = _plot_graph(GuiWidget(id="w1", kind=GuiWidgetKind.PLOT_WINDOW))

    result = await execute_graph(graph)
    assert result.status == "success"
    gui_result = next(r for r in result.node_results if r.node_id == "gui")
    assert gui_result.inputs["w1_in"] == "[1, 2, 3]"
    assert gui_result.outputs == {}


@pytest.mark.asyncio
async def test_plot_window_widget_transforms_value_into_inputs_snapshot():
    graph = _plot_graph(GuiWidget(id="w1", kind=GuiWidgetKind.PLOT_WINDOW, code=PLOT_TRANSFORM_JSON))

    result = await execute_graph(graph)
    assert result.status == "success"
    gui_result = next(r for r in result.node_results if r.node_id == "gui")
    assert gui_result.inputs["w1_in"] == [
        {"x": 0, "y": 1}, {"x": 1, "y": 2}, {"x": 2, "y": 3},
    ]


@pytest.mark.asyncio
async def test_plot_window_widget_broken_code_marks_node_error():
    graph = _plot_graph(GuiWidget(id="w1", kind=GuiWidgetKind.PLOT_WINDOW, code=PLOT_TRANSFORM_BROKEN))

    result = await execute_graph(graph)
    results_by_id = {r.node_id: r for r in result.node_results}
    assert results_by_id["gui"].status == "error"
    assert "boom" in results_by_id["gui"].error


# ---------------------------------------------------------------------------
# gui -> ai -> gui feedback loop (memory-node auto-deferred "t+1" edges)
#
# The user-built graph: one GUI node holding a file_open widget and a text_window
# widget, with the AI node in between. At node level that is a cycle
# (gui -> ai -> gui); a gui/widget node is a "memory" element (its output
# reflects its own persisted widget value, not this round's fresh input), so
# the closing edge is automatically treated as t+1 without the user marking it
# -- see graph_executor._effective_deferred_edge_ids.
# ---------------------------------------------------------------------------

def _gui_ai_gui_graph(fixture_path: Path, *, deferred: bool) -> Graph:
    gui = _gui_node("gui", [
        GuiWidget(id="w_file", kind=GuiWidgetKind.INPUT_PICKER, mode="file", label="Source File", value=str(fixture_path)),
        GuiWidget(id="w_text", kind=GuiWidgetKind.TEXT_IO, label="Answer"),
    ])
    ai = GraphNode(
        id="ai", node_type=NodeType.AI, label="Summarize",
        inputs=[Port(id="prompt", name="Prompt", kind=PortKind.INPUT, data_type=DataType.FILE_PATH)],
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(read_file_inputs=True),
    )
    return Graph(
        metadata=GraphMetadata(name="GUI file -> AI -> GUI text"),
        nodes=[gui, ai],
        edges=[
            GraphEdge(id="e1", source_node_id="gui", source_port_id="w_file_out",
                      target_node_id="ai", target_port_id="prompt"),
            GraphEdge(id="e2", source_node_id="ai", source_port_id="output",
                      target_node_id="gui", target_port_id="w_text_in",
                      deferred=deferred),
        ],
    )


@pytest.mark.asyncio
async def test_gui_to_ai_to_gui_without_explicit_deferred_edge_still_runs(tmp_path, monkeypatch):
    """A cycle closed by an edge into a gui/widget node is auto-deferred even
    without the user marking it -- the memory-node rule, not a regression."""
    fixture = tmp_path / "source.md"
    fixture.write_text("the quick brown fox\n", encoding="utf-8")

    async def fake_complete(prompt, system, model, temperature, provider):
        return f"summary:{prompt.strip()}"

    monkeypatch.setattr("app.services.graph_executor.ai_service.complete", fake_complete)

    result = await execute_graph(_gui_ai_gui_graph(fixture, deferred=False))

    assert result.status == ExecutionStatus.SUCCESS
    results_by_id = {r.node_id: r for r in result.node_results}
    assert results_by_id["gui"].status == ExecutionStatus.SUCCESS
    # No previous round, so the auto-deferred edge delivers nothing this round.
    assert "w_text_in" not in results_by_id["gui"].inputs


@pytest.mark.asyncio
async def test_non_cyclic_edge_into_gui_node_still_delivers_same_round():
    """A plain code -> gui display wire (no loop back) is NOT auto-deferred --
    the memory-node rule only kicks in for edges actually needed to break a cycle."""
    code = GraphNode(
        id="code", node_type=NodeType.CODE, label="Compute",
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(code="def run(inputs):\n    return {'output': 'hello'}\n"),
    )
    gui = _gui_node("gui", [GuiWidget(id="w_text", kind=GuiWidgetKind.TEXT_IO, label="Answer")])
    graph = Graph(
        metadata=GraphMetadata(name="Code -> GUI display"),
        nodes=[code, gui],
        edges=[
            GraphEdge(id="e1", source_node_id="code", source_port_id="output",
                      target_node_id="gui", target_port_id="w_text_in"),
        ],
    )
    result = await execute_graph(graph)
    assert result.status == ExecutionStatus.SUCCESS
    results_by_id = {r.node_id: r for r in result.node_results}
    # Delivered in the SAME round -- not held back like a real (cycle-closing) t+1 edge.
    assert results_by_id["gui"].inputs["w_text_in"] == "hello"
    assert results_by_id["gui"].outputs["w_text_out"] == "hello"



@pytest.mark.asyncio
async def test_gui_file_open_to_ai_to_gui_text_window_runs_with_deferred_edge(tmp_path, monkeypatch):
    """The closing edge marked deferred makes the loop runnable and carries the
    AI answer into the text_window on the NEXT round, not the current one."""
    fixture = tmp_path / "source.md"
    fixture.write_text("the quick brown fox\n", encoding="utf-8")

    recorded_prompts: list[str] = []

    async def fake_complete(prompt, system, model, temperature, provider):
        recorded_prompts.append(prompt)
        return f"summary:{prompt.strip()}"

    monkeypatch.setattr("app.services.graph_executor.ai_service.complete", fake_complete)

    graph = _gui_ai_gui_graph(fixture, deferred=True)

    # --- round 1: no previous outputs, so the text_window gets nothing at all ---
    first = await execute_graph(graph)
    assert first.status == ExecutionStatus.SUCCESS

    first_results = {r.node_id: r for r in first.node_results}
    assert first_results["gui"].status == ExecutionStatus.SUCCESS
    assert first_results["ai"].status == ExecutionStatus.SUCCESS

    # The file_open widget emitted the resolved path...
    assert first_results["gui"].outputs["w_file_out"] == str(fixture.resolve())
    # ...and the AI node received the file's *content* (read_file_inputs).
    assert recorded_prompts == ["the quick brown fox\n"]
    assert first_results["ai"].outputs["output"] == "summary:the quick brown fox"

    # Deferred edge with no previous round and no initial_value -> no value at all.
    assert "w_text_in" not in first_results["gui"].inputs
    assert first_results["gui"].outputs["w_text_out"] == ""

    # --- round 2: feed round 1's outputs back in; now the t+1 edge delivers ---
    previous_outputs = {
        r.node_id: r.outputs for r in first.node_results
        if r.status == ExecutionStatus.SUCCESS
    }
    second = await execute_graph(graph, previous_outputs=previous_outputs)
    assert second.status == ExecutionStatus.SUCCESS

    second_results = {r.node_id: r for r in second.node_results}
    assert second_results["gui"].inputs["w_text_in"] == "summary:the quick brown fox"
    assert second_results["gui"].outputs["w_text_out"] == "summary:the quick brown fox"


@pytest.mark.asyncio
async def test_deferred_edge_uses_initial_value_on_first_round(tmp_path, monkeypatch):
    """With an initial_value set, round 1 seeds the text_window instead of leaving it empty."""
    fixture = tmp_path / "source.md"
    fixture.write_text("hello\n", encoding="utf-8")

    async def fake_complete(prompt, system, model, temperature, provider):
        return "answer"

    monkeypatch.setattr("app.services.graph_executor.ai_service.complete", fake_complete)

    graph = _gui_ai_gui_graph(fixture, deferred=True)
    next(e for e in graph.edges if e.id == "e2").initial_value = "waiting..."

    result = await execute_graph(graph)
    assert result.status == ExecutionStatus.SUCCESS

    gui_result = next(r for r in result.node_results if r.node_id == "gui")
    assert gui_result.inputs["w_text_in"] == "waiting..."
    assert gui_result.outputs["w_text_out"] == "waiting..."
