"""
Backend tests – graph model validation, executor, and API endpoints.
Run with:  pytest backend/tests/ -v
"""

from __future__ import annotations

import json
import pytest
import asyncio
from pathlib import Path

# ---------------------------------------------------------------------------
# Graph model tests
# ---------------------------------------------------------------------------

def test_graph_dsl_round_trip():
    """Graph DSL serialises and deserialises without data loss."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig, NodePosition

    g = Graph(
        metadata=GraphMetadata(name="Test", version="1.0.0"),
        nodes=[
            GraphNode(
                id="n1",
                node_type=NodeType.TEXT_INPUT,
                label="Input",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False, description="")],
                config=NodeConfig(value="hello"),
            ),
            GraphNode(
                id="n2",
                node_type=NodeType.OUTPUT,
                label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False, description="")],
                config=NodeConfig(output_label="Result"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="n1", source_port_id="output", target_node_id="n2", target_port_id="value"),
        ],
    )

    serialised = g.model_dump_json()
    restored = Graph.model_validate_json(serialised)

    assert restored.metadata.name == "Test"
    assert len(restored.nodes) == 2
    assert len(restored.edges) == 1
    assert restored.nodes[0].config.value == "hello"


def test_example_graphs_valid():
    """All example JSON files are valid graph DSL."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph

    examples_dir = Path(__file__).parent.parent.parent / "examples"
    for example in examples_dir.glob("*.json"):
        graph = Graph.model_validate_json(example.read_text())
        assert graph.metadata.name


def test_connector_formats_decode_json_and_csv():
    from app.services.graph_executor import _decode_value

    assert _decode_value('{"name": "Ada"}', "application/json") == {"name": "Ada"}
    assert _decode_value("name\nAda\n", "text/csv") == [{"name": "Ada"}]
    assert _decode_value(["1", "2"], "text/plain") == ["1", "2"]


def test_connector_debug_snapshot_uses_declared_format(tmp_path):
    from app.models.graph import Port, PortKind, DataType
    from app.services.graph_executor import _debug_connector_value

    port = Port(
        id="payload",
        name="Payload",
        kind=PortKind.OUTPUT,
        data_type=DataType.JSON,
        format="application/json",
        debug_directory=str(tmp_path),
    )
    _debug_connector_value("node", port, {"ok": True}, "out", 0)

    snapshot = tmp_path / "node_payload_out_0.json"
    assert json.loads(snapshot.read_text()) == {"ok": True}


def test_graph_validation_allows_one_to_one_wiring():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig

    graph = Graph(
        metadata=GraphMetadata(name="One To One"),
        nodes=[
            GraphNode(
                id="source",
                node_type=NodeType.TEXT_INPUT,
                label="Source",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="hello"),
            ),
            GraphNode(
                id="target",
                node_type=NodeType.OUTPUT,
                label="Target",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)],
                config=NodeConfig(output_label="Result"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="source", source_port_id="output", target_node_id="target", target_port_id="value"),
        ],
    )

    assert graph.edges[0].id == "e1"


def test_graph_validation_allows_implicit_fan_out_without_split():
    """Connectors may branch implicitly; a SPLIT node is not required."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig

    graph = Graph(
        metadata=GraphMetadata(name="Implicit Fan Out"),
        nodes=[
            GraphNode(
                id="source",
                node_type=NodeType.TEXT_INPUT,
                label="Source",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="hello"),
            ),
            GraphNode(
                id="left",
                node_type=NodeType.OUTPUT,
                label="Left",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)],
                config=NodeConfig(output_label="Left"),
            ),
            GraphNode(
                id="right",
                node_type=NodeType.OUTPUT,
                label="Right",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)],
                config=NodeConfig(output_label="Right"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="source", source_port_id="output", target_node_id="left", target_port_id="value"),
            GraphEdge(id="e2", source_node_id="source", source_port_id="output", target_node_id="right", target_port_id="value"),
        ],
    )

    assert len(graph.edges) == 2


def test_graph_validation_allows_implicit_fan_in_without_merge():
    """Connectors may join implicitly; a MERGE node is not required."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig

    graph = Graph(
        metadata=GraphMetadata(name="Implicit Fan In"),
        nodes=[
            GraphNode(
                id="left",
                node_type=NodeType.TEXT_INPUT,
                label="Left",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="hello"),
            ),
            GraphNode(
                id="right",
                node_type=NodeType.TEXT_INPUT,
                label="Right",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="world"),
            ),
            GraphNode(
                id="target",
                node_type=NodeType.OUTPUT,
                label="Target",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)],
                config=NodeConfig(output_label="Result"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="left", source_port_id="output", target_node_id="target", target_port_id="value"),
            GraphEdge(id="e2", source_node_id="right", source_port_id="output", target_node_id="target", target_port_id="value"),
        ],
    )

    assert len(graph.edges) == 2


def test_graph_validation_allows_fan_out_from_split():
    """A `code` node (the migrated equivalent of the deleted `split` node type)
    can still fan its output out to multiple downstream nodes."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig

    split_code = (
        "def run(inputs):\n"
        "    source = next(iter(inputs.values()), '')\n"
        "    parts = str(source).split('\\n') if source else []\n"
        "    return {'items': parts, 'count': len(parts)}\n"
    )

    graph = Graph(
        metadata=GraphMetadata(name="Explicit Split"),
        nodes=[
            GraphNode(
                id="source",
                node_type=NodeType.TEXT_INPUT,
                label="Source",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="one\ntwo"),
            ),
            GraphNode(
                id="split",
                node_type=NodeType.CODE,
                label="Split",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=False, required=False)],
                outputs=[Port(id="items", name="Items", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True, required=False)],
                config=NodeConfig(code=split_code, batch_mode="whole_list"),
            ),
            GraphNode(
                id="left",
                node_type=NodeType.OUTPUT,
                label="Left",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)],
                config=NodeConfig(output_label="Left"),
            ),
            GraphNode(
                id="right",
                node_type=NodeType.OUTPUT,
                label="Right",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)],
                config=NodeConfig(output_label="Right"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="source", source_port_id="output", target_node_id="split", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="split", source_port_id="items", target_node_id="left", target_port_id="value"),
            GraphEdge(id="e3", source_node_id="split", source_port_id="items", target_node_id="right", target_port_id="value"),
        ],
    )

    assert graph.edges[-1].id == "e3"


def test_graph_validation_allows_fan_in_into_merge():
    """A `code` node (the migrated equivalent of the deleted `merge` node type)
    can still take multiple fanned-in edges on one multi input port."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig

    concat_code = (
        "def run(inputs):\n"
        "    parts = []\n"
        "    for val in inputs.values():\n"
        "        if isinstance(val, list):\n"
        "            parts.extend(str(v) for v in val)\n"
        "        elif val is not None:\n"
        "            parts.append(str(val))\n"
        "    return {'output': ' '.join(parts)}\n"
    )

    graph = Graph(
        metadata=GraphMetadata(name="Explicit Merge"),
        nodes=[
            GraphNode(
                id="left",
                node_type=NodeType.TEXT_INPUT,
                label="Left",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="hello"),
            ),
            GraphNode(
                id="right",
                node_type=NodeType.TEXT_INPUT,
                label="Right",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="world"),
            ),
            GraphNode(
                id="merge",
                node_type=NodeType.CODE,
                label="Merge",
                inputs=[Port(id="inputs", name="Inputs", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(code=concat_code, batch_mode="whole_list"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="left", source_port_id="output", target_node_id="merge", target_port_id="inputs"),
            GraphEdge(id="e2", source_node_id="right", source_port_id="output", target_node_id="merge", target_port_id="inputs"),
        ],
    )

    assert graph.nodes[-1].node_type == NodeType.CODE


@pytest.mark.asyncio
async def test_legacy_merge_split_nodes_migrate_to_equivalent_code_nodes():
    """Loading a graph JSON containing legacy `merge`/`split` node types
    rewrites them in place to equivalent `code` nodes (Graph._migrate_legacy_nodes
    in models/graph.py), preserving ports so existing edges still resolve, and
    producing identical output values to what the deleted MergeElement/
    SplitElement used to compute for the same inputs."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, NodeType
    from app.services.graph_executor import execute_graph

    raw = {
        "metadata": {"name": "Legacy Merge/Split"},
        "nodes": [
            {
                "id": "left", "node_type": "text_input", "label": "Left",
                "outputs": [{"id": "output", "name": "Output", "kind": "output", "data_type": "text", "required": False}],
                "config": {"value": "2"},
            },
            {
                "id": "right", "node_type": "text_input", "label": "Right",
                "outputs": [{"id": "output", "name": "Output", "kind": "output", "data_type": "text", "required": False}],
                "config": {"value": "3"},
            },
            {
                "id": "merge_sum", "node_type": "merge", "label": "Sum",
                "inputs": [{"id": "inputs", "name": "Inputs", "kind": "input", "data_type": "any", "multi": True, "required": False}],
                "outputs": [{"id": "output", "name": "Output", "kind": "output", "data_type": "text", "required": False}],
                "config": {"merge_mode": "sum", "separator": "\n"},
            },
            {
                "id": "source", "node_type": "text_input", "label": "Source",
                "outputs": [{"id": "output", "name": "Output", "kind": "output", "data_type": "text", "required": False}],
                "config": {"value": "a,b,c"},
            },
            {
                "id": "split", "node_type": "split", "label": "Split",
                "inputs": [{"id": "input", "name": "Input", "kind": "input", "data_type": "text", "required": False}],
                "outputs": [
                    {"id": "items", "name": "Items", "kind": "output", "data_type": "text", "multi": True, "required": False},
                    {"id": "count", "name": "Count", "kind": "output", "data_type": "text", "required": False},
                ],
                "config": {"separator": ","},
            },
            {
                "id": "merge_out", "node_type": "output", "label": "MergeOut",
                "inputs": [{"id": "value", "name": "Value", "kind": "input", "data_type": "any", "multi": True, "required": False}],
                "config": {"output_label": "MergeResult"},
            },
            {
                "id": "split_out", "node_type": "output", "label": "SplitOut",
                "inputs": [{"id": "value", "name": "Value", "kind": "input", "data_type": "any", "multi": True, "required": False}],
                "config": {"output_label": "SplitResult"},
            },
        ],
        "edges": [
            {"id": "e1", "source_node_id": "left", "source_port_id": "output", "target_node_id": "merge_sum", "target_port_id": "inputs"},
            {"id": "e2", "source_node_id": "right", "source_port_id": "output", "target_node_id": "merge_sum", "target_port_id": "inputs"},
            {"id": "e3", "source_node_id": "merge_sum", "source_port_id": "output", "target_node_id": "merge_out", "target_port_id": "value"},
            {"id": "e4", "source_node_id": "source", "source_port_id": "output", "target_node_id": "split", "target_port_id": "input"},
            {"id": "e5", "source_node_id": "split", "source_port_id": "items", "target_node_id": "split_out", "target_port_id": "value"},
        ],
    }

    graph = Graph.model_validate(raw)

    merge_node = next(n for n in graph.nodes if n.id == "merge_sum")
    split_node = next(n for n in graph.nodes if n.id == "split")

    # node_type rewritten; MERGE/SPLIT no longer exist as NodeType members at all.
    assert merge_node.node_type == NodeType.CODE
    assert split_node.node_type == NodeType.CODE
    assert not hasattr(NodeType, "MERGE")
    assert not hasattr(NodeType, "SPLIT")

    # Ports preserved exactly -- existing edges (e1/e2/e3, e4/e5) still resolve.
    assert [p.id for p in merge_node.inputs] == ["inputs"]
    assert [p.id for p in merge_node.outputs] == ["output"]
    assert [p.id for p in split_node.inputs] == ["input"]
    assert [p.id for p in split_node.outputs] == ["items", "count"]

    result = await execute_graph(graph)
    assert result.status == "success"

    # sum(["2", "3"]) == 5 -- identical to the deleted MergeElement's sum mode.
    assert result.final_outputs["MergeResult"]["value"] == 5
    # "a,b,c".split(",") == ["a", "b", "c"] -- identical to the deleted SplitElement.
    assert result.final_outputs["SplitResult"]["value"] == ["a", "b", "c"]



# ---------------------------------------------------------------------------
# Topological sort tests
# ---------------------------------------------------------------------------

def test_topological_sort_linear():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import GraphNode, GraphEdge, NodeType, NodeConfig, NodePosition
    from app.services.graph_executor import _topological_sort

    nodes = [
        GraphNode(id="a", node_type=NodeType.TEXT_INPUT, label="A"),
        GraphNode(id="b", node_type=NodeType.CODE, label="B"),
        GraphNode(id="c", node_type=NodeType.OUTPUT, label="C"),
    ]
    edges = [
        GraphEdge(id="e1", source_node_id="a", source_port_id="out", target_node_id="b", target_port_id="in"),
        GraphEdge(id="e2", source_node_id="b", source_port_id="out", target_node_id="c", target_port_id="in"),
    ]
    order = _topological_sort(nodes, edges)
    assert order.index("a") < order.index("b") < order.index("c")


def test_topological_sort_cycle():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import GraphNode, GraphEdge, NodeType
    from app.services.graph_executor import _topological_sort

    nodes = [
        GraphNode(id="a", node_type=NodeType.CODE, label="A"),
        GraphNode(id="b", node_type=NodeType.CODE, label="B"),
    ]
    edges = [
        GraphEdge(id="e1", source_node_id="a", source_port_id="out", target_node_id="b", target_port_id="in"),
        GraphEdge(id="e2", source_node_id="b", source_port_id="out", target_node_id="a", target_port_id="in"),
    ]
    with pytest.raises(ValueError, match="cycle"):
        _topological_sort(nodes, edges)


# ---------------------------------------------------------------------------
# Graph executor integration tests (no AI calls)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_execute_text_input_to_output():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig
    from app.services.graph_executor import execute_graph

    graph = Graph(
        metadata=GraphMetadata(name="Test"),
        nodes=[
            GraphNode(
                id="n1",
                node_type=NodeType.TEXT_INPUT,
                label="Input",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False, description="")],
                config=NodeConfig(value="test-value"),
            ),
            GraphNode(
                id="n2",
                node_type=NodeType.OUTPUT,
                label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False, description="")],
                config=NodeConfig(output_label="MyOutput"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="n1", source_port_id="output", target_node_id="n2", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    assert result.status == "success"
    assert "MyOutput" in result.final_outputs
    assert result.final_outputs["MyOutput"]["value"] == "test-value"


@pytest.mark.asyncio
async def test_execute_code_node():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig
    from app.services.graph_executor import execute_graph

    code = "def run(inputs):\n    return {'result': int(inputs.get('x', 0)) * 2}\n"

    graph = Graph(
        metadata=GraphMetadata(name="Code Test"),
        nodes=[
            GraphNode(
                id="n1",
                node_type=NodeType.TEXT_INPUT,
                label="Num",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False, description="")],
                config=NodeConfig(value="21"),
            ),
            GraphNode(
                id="n2",
                node_type=NodeType.CODE,
                label="Double",
                inputs=[Port(id="x", name="x", kind=PortKind.INPUT, data_type=DataType.ANY, multi=False, required=False, description="")],
                outputs=[Port(id="result", name="result", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=False, required=False, description="")],
                config=NodeConfig(language="python", code=code),
            ),
            GraphNode(
                id="n3",
                node_type=NodeType.OUTPUT,
                label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False, description="")],
                config=NodeConfig(output_label="Doubled"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="n1", source_port_id="output", target_node_id="n2", target_port_id="x"),
            GraphEdge(id="e2", source_node_id="n2", source_port_id="result", target_node_id="n3", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    assert result.status == "success"
    doubled_out = result.final_outputs.get("Doubled", {})
    assert doubled_out.get("value") == 42


@pytest.mark.asyncio
async def test_code_node_processes_each_batch_item():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig, _generate_split_code
    from app.services.graph_executor import execute_graph

    graph = Graph(
        metadata=GraphMetadata(name="Batch Code Test"),
        nodes=[
            GraphNode(
                id="input", node_type=NodeType.TEXT_INPUT, label="Input",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="one\ntwo\nthree"),
            ),
            GraphNode(
                id="split", node_type=NodeType.CODE, label="Split",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=False)],
                outputs=[Port(id="items", name="Items", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True)],
                config=NodeConfig(code=_generate_split_code("\n"), batch_mode="whole_list"),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="Uppercase",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True)],
                config=NodeConfig(code="def run(inputs):\n    return {'output': inputs['input'].upper()}\n"),
            ),
            GraphNode(
                id="output", node_type=NodeType.OUTPUT, label="Output",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=True)],
                config=NodeConfig(output_label="Batch"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="input", source_port_id="output", target_node_id="split", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="split", source_port_id="items", target_node_id="code", target_port_id="input"),
            GraphEdge(id="e3", source_node_id="code", source_port_id="output", target_node_id="output", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    assert result.status == "success"
    assert result.final_outputs["Batch"]["value"] == ["ONE", "TWO", "THREE"]


@pytest.mark.asyncio
async def test_ai_node_processes_each_batch_item(monkeypatch):
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig, _generate_split_code
    from app.services.graph_executor import execute_graph

    async def fake_complete(prompt, system, model, temperature, provider):
        return f"answer:{prompt}"

    monkeypatch.setattr("app.services.graph_executor.ai_service.complete", fake_complete)
    graph = Graph(
        metadata=GraphMetadata(name="Batch AI Test"),
        nodes=[
            GraphNode(
                id="input", node_type=NodeType.TEXT_INPUT, label="Input",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                config=NodeConfig(value="first\nsecond"),
            ),
            GraphNode(
                id="split", node_type=NodeType.CODE, label="Split",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=False)],
                outputs=[Port(id="items", name="Items", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True)],
                config=NodeConfig(code=_generate_split_code("\n"), batch_mode="whole_list"),
            ),
            GraphNode(
                id="ai", node_type=NodeType.AI, label="Answer",
                inputs=[Port(id="prompt", name="Prompt", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True)],
            ),
            GraphNode(
                id="output", node_type=NodeType.OUTPUT, label="Output",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=True)],
                config=NodeConfig(output_label="Answers"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="input", source_port_id="output", target_node_id="split", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="split", source_port_id="items", target_node_id="ai", target_port_id="prompt"),
            GraphEdge(id="e3", source_node_id="ai", source_port_id="output", target_node_id="output", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    assert result.status == "success"
    assert result.final_outputs["Answers"]["value"] == ["answer:first", "answer:second"]


@pytest.mark.asyncio
async def test_single_item_batch_keeps_scalar_unless_port_is_multi(monkeypatch):
    """A one-item batch is not a fan-out: a non-multi output port must carry the
    scalar, while a multi port and a genuine multi-item batch still yield lists."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig, _generate_split_code
    from app.services.graph_executor import execute_graph

    async def fake_complete(prompt, system, model, temperature, provider):
        return f"answer:{prompt}"

    monkeypatch.setattr("app.services.graph_executor.ai_service.complete", fake_complete)

    def _graph(value: str, out_multi: bool) -> Graph:
        return Graph(
            metadata=GraphMetadata(name="Single Item Batch"),
            nodes=[
                GraphNode(
                    id="input", node_type=NodeType.TEXT_INPUT, label="Input",
                    outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                    config=NodeConfig(value=value),
                ),
                GraphNode(
                    id="split", node_type=NodeType.CODE, label="Split",
                    inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=False)],
                    outputs=[Port(id="items", name="Items", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True)],
                    config=NodeConfig(code=_generate_split_code("\n"), batch_mode="whole_list"),
                ),
                GraphNode(
                    id="ai", node_type=NodeType.AI, label="Answer",
                    inputs=[Port(id="prompt", name="Prompt", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=True)],
                    outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=out_multi)],
                ),
            ],
            edges=[
                GraphEdge(id="e1", source_node_id="input", source_port_id="output", target_node_id="split", target_port_id="input"),
                GraphEdge(id="e2", source_node_id="split", source_port_id="items", target_node_id="ai", target_port_id="prompt"),
            ],
        )

    async def _ai_output(value: str, out_multi: bool):
        result = await execute_graph(_graph(value, out_multi))
        assert result.status == "success"
        return next(r for r in result.node_results if r.node_id == "ai").outputs["output"]

    assert await _ai_output("solo", out_multi=False) == "answer:solo"
    assert await _ai_output("solo", out_multi=True) == ["answer:solo"]
    assert await _ai_output("one\ntwo", out_multi=False) == ["answer:one", "answer:two"]


@pytest.mark.asyncio
async def test_optional_multi_port_survives_one_failed_sibling(monkeypatch):
    """A failed predecessor feeding one contribution of an optional multi-port
    must not skip the downstream node; the other predecessor's value survives."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig, _generate_merge_code
    from app.services.graph_executor import execute_graph

    async def fake_complete(prompt, system, model, temperature, provider):
        raise ConnectionError("Ollama not running")

    monkeypatch.setattr("app.services.graph_executor.ai_service.complete", fake_complete)

    graph = Graph(
        metadata=GraphMetadata(name="Optional Multi Port Test"),
        nodes=[
            GraphNode(
                id="input_count", node_type=NodeType.TEXT_INPUT, label="Input Count",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="bla bla text"),
            ),
            GraphNode(
                id="input_ai", node_type=NodeType.TEXT_INPUT, label="Input AI",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="bla bla text"),
            ),
            GraphNode(
                id="count", node_type=NodeType.CODE, label="Count",
                inputs=[Port(id="text", name="Text", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=False, required=False)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(code="def run(inputs):\n    return {'output': str(inputs['text'].count('bla'))}\n"),
            ),
            GraphNode(
                id="ai", node_type=NodeType.AI, label="AI Count",
                inputs=[Port(id="prompt", name="Prompt", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=False, required=False)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
            ),
            GraphNode(
                id="merge", node_type=NodeType.CODE, label="Merge",
                inputs=[Port(id="inputs", name="Inputs", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(code=_generate_merge_code("concat", " "), batch_mode="whole_list"),
            ),
            GraphNode(
                id="text_output", node_type=NodeType.TEXT_OUTPUT, label="Text Output",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=False, required=False)],
                config=NodeConfig(output_label="Result"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="input_count", source_port_id="output", target_node_id="count", target_port_id="text"),
            GraphEdge(id="e2", source_node_id="input_ai", source_port_id="output", target_node_id="ai", target_port_id="prompt"),
            GraphEdge(id="e3", source_node_id="count", source_port_id="output", target_node_id="merge", target_port_id="inputs"),
            GraphEdge(id="e4", source_node_id="ai", source_port_id="output", target_node_id="merge", target_port_id="inputs"),
            GraphEdge(id="e5", source_node_id="merge", source_port_id="output", target_node_id="text_output", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    results_by_id = {r.node_id: r for r in result.node_results}

    assert results_by_id["ai"].status == "error"
    assert results_by_id["count"].status == "success"
    assert results_by_id["text_output"].status == "success"
    assert "2" in results_by_id["text_output"].outputs["value"]


@pytest.mark.asyncio
async def test_required_single_port_still_skips_on_failed_predecessor(monkeypatch):
    """Regression: a single REQUIRED port fed by one failing predecessor must
    still cause the downstream node to be SKIPPED."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig
    from app.services.graph_executor import execute_graph

    graph = Graph(
        metadata=GraphMetadata(name="Required Single Port Test"),
        nodes=[
            GraphNode(
                id="failing", node_type=NodeType.CODE, label="Failing",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(code="def run(inputs):\n    raise ValueError('boom')\n"),
            ),
            GraphNode(
                id="downstream", node_type=NodeType.CODE, label="Downstream",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=False, required=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(code="def run(inputs):\n    return {'output': inputs['value']}\n"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="failing", source_port_id="output", target_node_id="downstream", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    results_by_id = {r.node_id: r for r in result.node_results}

    assert results_by_id["failing"].status == "error"
    assert results_by_id["downstream"].status == "skipped"
    assert "Value" in results_by_id["downstream"].error


@pytest.mark.asyncio
async def test_required_multi_port_survives_partial_failure(monkeypatch):
    """A REQUIRED multi-port with two sources, one failing, is still
    satisfiable as long as at least one source succeeds."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig, _generate_merge_code
    from app.services.graph_executor import execute_graph

    graph = Graph(
        metadata=GraphMetadata(name="Required Multi Port Test"),
        nodes=[
            GraphNode(
                id="ok", node_type=NodeType.TEXT_INPUT, label="OK",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="good"),
            ),
            GraphNode(
                id="failing", node_type=NodeType.CODE, label="Failing",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(code="def run(inputs):\n    raise ValueError('boom')\n"),
            ),
            GraphNode(
                id="downstream", node_type=NodeType.CODE, label="Downstream",
                inputs=[Port(id="inputs", name="Inputs", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(code=_generate_merge_code("concat", " "), batch_mode="whole_list"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="ok", source_port_id="output", target_node_id="downstream", target_port_id="inputs"),
            GraphEdge(id="e2", source_node_id="failing", source_port_id="output", target_node_id="downstream", target_port_id="inputs"),
        ],
    )

    result = await execute_graph(graph)
    results_by_id = {r.node_id: r for r in result.node_results}

    assert results_by_id["failing"].status == "error"
    assert results_by_id["downstream"].status == "success"
    assert "good" in results_by_id["downstream"].outputs["output"]


def test_topological_levels_form_stage_barriers():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import GraphNode, GraphEdge, NodeType
    from app.services.graph_executor import _topological_levels

    nodes = [
        GraphNode(id="source", node_type=NodeType.TEXT_INPUT, label="Source"),
        GraphNode(id="left", node_type=NodeType.CODE, label="Left"),
        GraphNode(id="right", node_type=NodeType.CODE, label="Right"),
        GraphNode(id="join", node_type=NodeType.OUTPUT, label="Join"),
    ]
    edges = [
        GraphEdge(id="e1", source_node_id="source", source_port_id="out", target_node_id="left", target_port_id="in"),
        GraphEdge(id="e2", source_node_id="source", source_port_id="out", target_node_id="right", target_port_id="in"),
        GraphEdge(id="e3", source_node_id="left", source_port_id="out", target_node_id="join", target_port_id="in"),
        GraphEdge(id="e4", source_node_id="right", source_port_id="out", target_node_id="join", target_port_id="in"),
    ]

    assert _topological_levels(nodes, edges) == [["source"], ["left", "right"], ["join"]]


@pytest.mark.asyncio
async def test_execute_merge_node():
    """Regression for the deleted MERGE node type's concat behavior, now a
    plain `code` node (see models/graph.py's merge->code migration)."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig
    from app.services.graph_executor import execute_graph

    concat_code = (
        "def run(inputs):\n"
        "    parts = []\n"
        "    for val in inputs.values():\n"
        "        if isinstance(val, list):\n"
        "            parts.extend(str(v) for v in val)\n"
        "        elif val is not None:\n"
        "            parts.append(str(val))\n"
        "    return {'output': ' '.join(parts)}\n"
    )

    graph = Graph(
        metadata=GraphMetadata(name="Merge Test"),
        nodes=[
            GraphNode(id="a", node_type=NodeType.TEXT_INPUT, label="A",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False, description="")],
                config=NodeConfig(value="Hello")),
            GraphNode(id="b", node_type=NodeType.TEXT_INPUT, label="B",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False, description="")],
                config=NodeConfig(value="World")),
            GraphNode(id="m", node_type=NodeType.CODE, label="Merge",
                inputs=[Port(id="inputs", name="Inputs", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False, description="")],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False, description="")],
                config=NodeConfig(code=concat_code, batch_mode="whole_list")),
            GraphNode(id="o", node_type=NodeType.OUTPUT, label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False, description="")],
                config=NodeConfig(output_label="Merged")),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="a", source_port_id="output", target_node_id="m", target_port_id="inputs"),
            GraphEdge(id="e2", source_node_id="b", source_port_id="output", target_node_id="m", target_port_id="inputs"),
            GraphEdge(id="e3", source_node_id="m", source_port_id="output", target_node_id="o", target_port_id="value"),
        ],
    )
    result = await execute_graph(graph)
    assert result.status == "success"
    merged = result.final_outputs.get("Merged", {}).get("value", "")
    assert "Hello" in merged
    assert "World" in merged


@pytest.mark.asyncio
async def test_merge_node_decodes_each_edge_with_its_own_format():
    """Regression: a multi-input port fed by several edges with different declared
    formats must decode each contributing value with its OWN source edge's
    format, not one uniform port-level format (previously the first edge's
    format – found via _effective_input_format – was applied to every value,
    which could crash on plain-text siblings or leave JSON siblings undecoded).
    Uses a `code` node running the deleted MERGE node's json_list logic, since
    this per-edge format decoding is generic graph_executor behavior, not
    specific to the (now-deleted) MERGE node type."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig
    from app.services.graph_executor import execute_graph

    json_list_code = (
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

    graph = Graph(
        metadata=GraphMetadata(name="Merge Mixed Format Test"),
        nodes=[
            GraphNode(id="json_src", node_type=NodeType.TEXT_INPUT, label="JSON Source",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT,
                               multi=False, required=False, format="json")],
                config=NodeConfig(value='{"n": 3}')),
            GraphNode(id="text_src", node_type=NodeType.TEXT_INPUT, label="Text Source",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT,
                               multi=False, required=False)],
                config=NodeConfig(value="hello")),
            GraphNode(id="num_src", node_type=NodeType.TEXT_INPUT, label="Num Source",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT,
                               multi=False, required=False)],
                config=NodeConfig(value="42")),
            GraphNode(id="m", node_type=NodeType.CODE, label="Merge",
                inputs=[Port(id="inputs", name="Inputs", kind=PortKind.INPUT, data_type=DataType.ANY,
                              multi=True, required=False)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT,
                               multi=False, required=False)],
                config=NodeConfig(code=json_list_code, batch_mode="whole_list")),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="json_src", source_port_id="output", target_node_id="m", target_port_id="inputs"),
            GraphEdge(id="e2", source_node_id="text_src", source_port_id="output", target_node_id="m", target_port_id="inputs"),
            GraphEdge(id="e3", source_node_id="num_src", source_port_id="output", target_node_id="m", target_port_id="inputs"),
        ],
    )

    result = await execute_graph(graph)
    results_by_id = {r.node_id: r for r in result.node_results}

    assert result.status == "success"
    assert results_by_id["m"].status == "success"

    merged_inputs = results_by_id["m"].inputs["inputs"]
    assert merged_inputs[0] == {"n": 3}  # JSON-decoded using its own edge's format
    assert merged_inputs[1] == "hello"   # left as plain text, not JSON-parsed
    assert merged_inputs[2] == "42"      # left as plain text, not JSON-parsed

    output = json.loads(results_by_id["m"].outputs["output"])
    assert output == [{"n": 3}, "hello", "42"]


@pytest.mark.asyncio
async def test_output_node_writes_json_file(tmp_path):
    """Output node's file write mode honors the value port's effective format."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig
    from app.services.graph_executor import execute_graph

    out_path = tmp_path / "result"
    graph = Graph(
        metadata=GraphMetadata(name="Output JSON Test"),
        nodes=[
            GraphNode(id="src", node_type=NodeType.TEXT_INPUT, label="Source",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT,
                               multi=False, required=False, format="json")],
                config=NodeConfig(value='{"a": 1, "b": [2, 3]}')),
            GraphNode(id="o", node_type=NodeType.OUTPUT, label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY,
                              multi=True, required=False)],
                config=NodeConfig(output_label="Result", write_mode="file", value=str(out_path))),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="src", source_port_id="output", target_node_id="o", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    results_by_id = {r.node_id: r for r in result.node_results}
    assert result.status == "success"

    written_path = Path(results_by_id["o"].outputs["written_path"])
    assert written_path.suffix == ".json"
    assert json.loads(written_path.read_text(encoding="utf-8")) == {"a": 1, "b": [2, 3]}


@pytest.mark.asyncio
async def test_output_node_directory_write_uses_per_port_format(tmp_path):
    """Output node's directory write mode picks each port's own effective
    format for its file's serialization/extension."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig
    from app.services.graph_executor import execute_graph

    graph = Graph(
        metadata=GraphMetadata(name="Output Directory Test"),
        nodes=[
            GraphNode(id="json_src", node_type=NodeType.TEXT_INPUT, label="JSON Source",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT,
                               multi=False, required=False, format="json")],
                config=NodeConfig(value="[1, 2, 3]")),
            GraphNode(id="text_src", node_type=NodeType.TEXT_INPUT, label="Text Source",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT,
                               multi=False, required=False)],
                config=NodeConfig(value="plain")),
            GraphNode(id="o", node_type=NodeType.OUTPUT, label="Out",
                inputs=[
                    Port(id="data", name="Data", kind=PortKind.INPUT, data_type=DataType.ANY, multi=False, required=False),
                    Port(id="note", name="Note", kind=PortKind.INPUT, data_type=DataType.ANY, multi=False, required=False),
                ],
                config=NodeConfig(output_label="Result", write_mode="directory", value=str(tmp_path / "out"))),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="json_src", source_port_id="output", target_node_id="o", target_port_id="data"),
            GraphEdge(id="e2", source_node_id="text_src", source_port_id="output", target_node_id="o", target_port_id="note"),
        ],
    )

    result = await execute_graph(graph)
    results_by_id = {r.node_id: r for r in result.node_results}
    assert result.status == "success"

    written_paths = results_by_id["o"].outputs["written_paths"]
    json_path = next(p for p in written_paths if Path(p).suffix == ".json")
    text_path = next(p for p in written_paths if Path(p).suffix == ".txt")
    assert Path(json_path).stem.startswith("data")
    assert Path(text_path).stem.startswith("note")
    assert json.loads(Path(json_path).read_text(encoding="utf-8")) == [1, 2, 3]
    assert Path(text_path).read_text(encoding="utf-8") == "plain"


@pytest.mark.asyncio
async def test_single_json_edge_does_not_double_decode_array_strings():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig
    from app.services.graph_executor import execute_graph

    graph = Graph(
        metadata=GraphMetadata(name="JSON array passthrough"),
        nodes=[
            GraphNode(id="src", node_type=NodeType.TEXT_INPUT, label="Source",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT,
                               multi=False, required=False, format="json")],
                config=NodeConfig(value='["plain text", "42"]')),
            GraphNode(id="out", node_type=NodeType.OUTPUT, label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY,
                              multi=True, required=False, format="json")],
                config=NodeConfig(output_label="Result")),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="src", source_port_id="output", target_node_id="out", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)

    assert result.status == "success"
    assert result.final_outputs["Result"]["value"] == ["plain text", "42"]


# ---------------------------------------------------------------------------
# Code executor unit tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_python_executor_basic():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.services.code_executor import execute_python

    code = "def run(inputs):\n    return {'doubled': inputs['x'] * 2}\n"
    result = await execute_python(code, {"x": 5})
    assert result["doubled"] == 10


@pytest.mark.asyncio
async def test_python_executor_error():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.services.code_executor import execute_python

    code = "def run(inputs):\n    raise ValueError('oops')\n"
    with pytest.raises(RuntimeError):
        await execute_python(code, {})


# ---------------------------------------------------------------------------
# Deployment service tests
# ---------------------------------------------------------------------------

def test_generate_docker_compose():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphMetadata
    from app.services.deploy_service import generate_docker_compose

    graph = Graph(metadata=GraphMetadata(name="My Graph"))
    compose = generate_docker_compose(graph)
    assert "my-graph-runner" in compose
    assert "ollama" in compose


def test_generate_deployment_bundle_layout():
    """The bundle vendors the real engine (app/**) plus graph.json/main.py --
    not a generated script -- and main.py is graph-runner/run.py verbatim."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphMetadata
    from app.services.deploy_service import generate_deployment_bundle

    graph = Graph(metadata=GraphMetadata(name="Test Bundle"))
    bundle = generate_deployment_bundle(graph)

    expected_extras = {"graph.json", "main.py", "requirements.txt", "Dockerfile", "docker-compose.yml", "README.md"}
    assert expected_extras <= set(bundle.keys())
    assert any(path.startswith("app/elements/") for path in bundle)
    assert "app/models/graph.py" in bundle
    assert "app/services/graph_executor.py" in bundle
    assert bundle["requirements.txt"].strip() == "pydantic==2.13.4"
    assert "build: ." in bundle["docker-compose.yml"]

    runner_source = (Path(__file__).parent.parent.parent / "graph-runner" / "run.py").read_text(encoding="utf-8")
    assert bundle["main.py"] == runner_source


def test_generate_deployment_bundle_requires_httpx_for_ai_node():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphMetadata, GraphNode, NodeType, Port, PortKind, DataType
    from app.services.deploy_service import generate_deployment_bundle

    graph = Graph(
        metadata=GraphMetadata(name="AI Bundle"),
        nodes=[
            GraphNode(
                id="ai", node_type=NodeType.AI, label="Answer",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
            ),
        ],
    )
    bundle = generate_deployment_bundle(graph)
    assert bundle["requirements.txt"].strip().splitlines() == ["pydantic==2.13.4", "httpx==0.28.1"]


def test_generate_deployment_bundle_vendors_gui_node_support(tmp_path):
    """A graph containing a `gui` node must still produce a bundle whose
    vendored app/ package can run it -- the gui widget element files must be
    included alongside the gui node element itself."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import (
        Graph, GraphEdge, GraphMetadata, GraphNode, GuiWidget, GuiWidgetKind,
        NodeConfig, NodeType, Port, PortKind, DataType, sync_gui_node_ports,
    )
    from app.services.deploy_service import generate_deployment_bundle

    fixture = tmp_path / "note.txt"
    fixture.write_text("hello", encoding="utf-8")

    gui = GraphNode(
        id="gui", node_type=NodeType.GUI, label="GUI",
        config=NodeConfig(gui_widgets=[
            GuiWidget(id="w1", kind=GuiWidgetKind.FILE_OPEN, label="File", value=str(fixture)),
            GuiWidget(id="w2", kind=GuiWidgetKind.TEXT_WINDOW, label="Text", value="hello text"),
        ]),
    )
    sync_gui_node_ports(gui)
    downstream = GraphNode(
        id="out", node_type=NodeType.OUTPUT, label="Out",
        inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
        config=NodeConfig(output_label="Result"),
    )

    graph = Graph(
        metadata=GraphMetadata(name="GUI Deploy Test"),
        nodes=[gui, downstream],
        edges=[
            GraphEdge(id="e1", source_node_id="gui", source_port_id="w1_out", target_node_id="out", target_port_id="value"),
        ],
    )

    bundle = generate_deployment_bundle(graph)
    assert "app/elements/gui/gui_element.py" in bundle
    assert "app/elements/gui/widgets/input_picker/input_picker_element.py" in bundle
    assert "app/elements/gui/widgets/text_io/text_io_element.py" in bundle
    assert json.loads(bundle["graph.json"])["nodes"][0]["node_type"] == "gui"
