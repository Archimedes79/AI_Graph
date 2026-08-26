"""
Tests for AI-authored Graph DSL generation (ai_service.generate_graph) and for
plot_window GUI widgets executing without an output port.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import (  # noqa: E402
    DataType,
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
)
from app.services import ai_service  # noqa: E402
from app.services.graph_executor import execute_graph  # noqa: E402

VALID_GRAPH_JSON = """
```json
{
  "metadata": {"name": "Greeter", "version": "1.0.0", "description": "", "author": "", "tags": []},
  "nodes": [
    {
      "id": "in", "node_type": "text_input", "label": "Input", "description": "",
      "position": {"x": 0, "y": 0},
      "inputs": [],
      "outputs": [{"id": "output", "name": "Output", "kind": "output", "data_type": "text", "multi": false, "required": true}],
      "config": {"value": "hello"}
    },
    {
      "id": "out", "node_type": "output", "label": "Output", "description": "",
      "position": {"x": 200, "y": 0},
      "inputs": [{"id": "value", "name": "Value", "kind": "input", "data_type": "text", "multi": false, "required": true}],
      "outputs": [],
      "config": {}
    }
  ],
  "edges": [
    {"id": "e1", "source_node_id": "in", "source_port_id": "output", "target_node_id": "out", "target_port_id": "value"}
  ]
}
```
This graph feeds a literal greeting into an output node.
"""


@pytest.mark.asyncio
async def test_generate_graph_parses_valid_fenced_json(monkeypatch):
    captured = {}

    async def fake_complete(prompt, system, model, temperature, provider):
        captured["system"] = system
        return VALID_GRAPH_JSON

    monkeypatch.setattr(ai_service, "complete", fake_complete)

    graph_dict, explanation = await ai_service.generate_graph("Build a greeter graph")

    assert graph_dict["metadata"]["name"] == "Greeter"
    assert "greeting" in explanation

    # Must pass full Graph schema validation, same as GenerateGraphResponse would enforce.
    graph = Graph.model_validate(graph_dict)
    assert len(graph.nodes) == 2
    assert len(graph.edges) == 1
    assert "input, data, ai, code, output, gui" in captured["system"]
    assert "Define data nodes before code or ai nodes" in captured["system"]


@pytest.mark.asyncio
async def test_generate_graph_raises_on_malformed_json(monkeypatch):
    async def fake_complete(prompt, system, model, temperature, provider):
        return "```json\nnot valid json {{{\n```"

    monkeypatch.setattr(ai_service, "complete", fake_complete)

    with pytest.raises(ValueError):
        await ai_service.generate_graph("Build a broken graph")


@pytest.mark.asyncio
async def test_gui_node_with_plot_window_executes_without_crashing():
    gui = GraphNode(
        id="gui", node_type=NodeType.GUI, label="Plot",
    config=NodeConfig(gui_widgets=[GuiWidget(
      id="w1", kind=GuiWidgetKind.PLOT_WINDOW,
      code="def run(inputs):\n    return {'value': inputs.get('value')}\n",
    )]),
    )
    text_in = GraphNode(
        id="in", node_type=NodeType.INPUT, label="Input",
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(value="42"),
    )
    graph = Graph(
        metadata=GraphMetadata(name="PlotWindow"),
        nodes=[text_in, gui],
        edges=[GraphEdge(id="e1", source_node_id="in", source_port_id="output",
                          target_node_id="gui", target_port_id="w1_in")],
    )

    result = await execute_graph(graph)

    assert result.status == "success"
    gui_result = next(r for r in result.node_results if r.node_id == "gui")
    assert gui_result.status == "success"
    assert gui_result.inputs["w1_in"] == "42"
    assert gui_result.outputs == {}
