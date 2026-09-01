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
                node_type=NodeType.INPUT,
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


def test_graph_validation_allows_one_to_one_wiring():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig

    graph = Graph(
        metadata=GraphMetadata(name="One To One"),
        nodes=[
            GraphNode(
                id="source",
                node_type=NodeType.INPUT,
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
                node_type=NodeType.INPUT,
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
                node_type=NodeType.INPUT,
                label="Left",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="hello"),
            ),
            GraphNode(
                id="right",
                node_type=NodeType.INPUT,
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
                node_type=NodeType.INPUT,
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
                node_type=NodeType.INPUT,
                label="Left",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
                config=NodeConfig(value="hello"),
            ),
            GraphNode(
                id="right",
                node_type=NodeType.INPUT,
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


# ---------------------------------------------------------------------------
# Topological ordering tests
# ---------------------------------------------------------------------------

# These test `_topological_levels`, the ordering function `execute_graph`
# actually calls. A second, flat `_topological_sort` used to exist purely for
# these two tests; it ran the same Kahn's-algorithm pass over the same
# feedback-edge filter and was vendored into every deploy bundle unused.


# ---------------------------------------------------------------------------
# Graph executor integration tests (no AI calls)
# ---------------------------------------------------------------------------


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

