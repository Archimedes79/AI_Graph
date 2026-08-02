from __future__ import annotations

import builtins
import importlib.util
from pathlib import Path

import pytest


def _load_runner_module():
    root = Path(__file__).resolve().parents[2]
    runner_path = root / "graph-runner" / "run.py"
    spec = importlib.util.spec_from_file_location("graph_runner_run", runner_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_runner_uses_default_values_when_stdin_is_unavailable(capsys, monkeypatch):
    runner = _load_runner_module()
    graph_path = Path(__file__).resolve().parents[2] / "examples" / "hello_world.json"

    def raise_eof(prompt: str) -> str:
        raise EOFError(prompt)

    monkeypatch.setattr(builtins, "input", raise_eof)

    await runner.run(str(graph_path), {})

    captured = capsys.readouterr()
    assert '"status": "success"' in captured.out
    assert '"Hello Result"' in captured.out
    assert '"Hello, World!"' in captured.out


@pytest.mark.asyncio
async def test_runner_resolves_widget_scoped_gui_requirements_independently(tmp_path, monkeypatch):
    """
    Two empty file_open/directory_open widgets on the same GUI node each produce a
    RuntimeRequirement with a distinct widget_id. Before the fix, run.py's
    interactive-resolution loop keyed `resolved` by the plain node_id for every
    requirement, so the second widget's answer overwrote the first's in
    `apply_runtime_values` -- both widgets ended up with only the last answer.
    """
    import sys

    runner = _load_runner_module()
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "backend"))
    from app.models.graph import (
        Graph, GraphMetadata, GraphNode, GuiWidget, GuiWidgetKind, NodeConfig, NodeType, sync_gui_node_ports,
    )

    gui = GraphNode(
        id="gui", node_type=NodeType.GUI, label="GUI",
        config=NodeConfig(gui_widgets=[
            GuiWidget(id="w1", kind=GuiWidgetKind.FILE_OPEN, label="File"),
            GuiWidget(id="w2", kind=GuiWidgetKind.DIRECTORY_OPEN, label="Dir"),
        ]),
    )
    sync_gui_node_ports(gui)
    graph = Graph(metadata=GraphMetadata(name="Widget Scoped"), nodes=[gui])
    graph_path = tmp_path / "graph.json"
    graph_path.write_text(graph.model_dump_json(), encoding="utf-8")

    file_value = str(tmp_path / "file.txt")
    (tmp_path / "file.txt").write_text("x", encoding="utf-8")
    dir_value = str(tmp_path)

    answers = iter([file_value, dir_value])
    monkeypatch.setattr(builtins, "input", lambda prompt: next(answers))

    captured_graph: dict = {}
    original_execute_graph = runner.execute_graph

    async def spy_execute_graph(g):
        captured_graph["graph"] = g
        return await original_execute_graph(g)

    monkeypatch.setattr(runner, "execute_graph", spy_execute_graph)

    await runner.run(str(graph_path), {})

    resolved_graph = captured_graph["graph"]
    gui_node = next(n for n in resolved_graph.nodes if n.id == "gui")
    widget_values = {w.id: w.value for w in gui_node.config.gui_widgets}
    assert widget_values["w1"] == file_value
    assert widget_values["w2"] == dir_value