from __future__ import annotations

import builtins
import importlib.util
import json
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
            GuiWidget(id="w1", kind=GuiWidgetKind.INPUT_PICKER, mode="file", label="File"),
            GuiWidget(id="w2", kind=GuiWidgetKind.INPUT_PICKER, mode="directory", label="Dir"),
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

@pytest.mark.asyncio
async def test_inputs_can_target_a_widget_that_already_holds_a_value(tmp_path, capsys, monkeypatch):
    """
    `--inputs node::widget=…` must reach the widget.

    Overrides used to be applied by a hand-rolled loop that matched node ids
    only, so a widget-scoped key was dropped without a word -- and because the
    prompt loop then skipped it as "supplied", the graph ran against whatever
    path it was saved with. Pointing a deployed tool at a file from a script is
    most of what a bundle is for, so this is the case that matters.
    """
    runner = _load_runner_module()

    data = tmp_path / "echt.txt"
    data.write_text("die richtige Datei", encoding="utf-8")

    graph_path = tmp_path / "g.json"
    graph_path.write_text(json.dumps({
        "metadata": {"name": "picker"},
        "nodes": [
            {
                "id": "panel", "node_type": "gui", "label": "Panel",
                "position": {"x": 0, "y": 0}, "inputs": [], "outputs": [],
                "config": {"gui_widgets": [{
                    "id": "picker", "kind": "input_picker", "mode": "file",
                    "label": "Datei", "value": "hoffentlich_nicht_diese.txt",
                }]},
            },
            {
                "id": "out", "node_type": "output", "label": "Ergebnis",
                "position": {"x": 300, "y": 0},
                "inputs": [{"id": "value", "name": "Value", "kind": "input",
                            "data_type": "any", "multi": True, "required": False}],
                "outputs": [], "config": {"output_label": "Pfad", "write_mode": "window"},
            },
        ],
        "edges": [{"id": "e1", "source_node_id": "panel", "source_port_id": "picker_out",
                   "target_node_id": "out", "target_port_id": "value"}],
    }), encoding="utf-8")

    monkeypatch.setattr(builtins, "input", lambda prompt: (_ for _ in ()).throw(EOFError(prompt)))

    await runner.run(str(graph_path), {"panel::picker": str(data)})

    out = capsys.readouterr().out
    assert '"status": "success"' in out
    assert str(data) in out.replace("\\\\", "\\")
    assert "hoffentlich_nicht_diese" not in out
