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
async def test_execute_merge_node():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphNode, GraphEdge, GraphMetadata, NodeType, Port, PortKind, DataType, NodeConfig
    from app.services.graph_executor import execute_graph

    graph = Graph(
        metadata=GraphMetadata(name="Merge Test"),
        nodes=[
            GraphNode(id="a", node_type=NodeType.TEXT_INPUT, label="A",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False, description="")],
                config=NodeConfig(value="Hello")),
            GraphNode(id="b", node_type=NodeType.TEXT_INPUT, label="B",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False, description="")],
                config=NodeConfig(value="World")),
            GraphNode(id="m", node_type=NodeType.MERGE, label="Merge",
                inputs=[Port(id="inputs", name="Inputs", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False, description="")],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False, description="")],
                config=NodeConfig(separator=" ")),
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


def test_generate_runner_script():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphMetadata
    from app.services.deploy_service import generate_runner_script

    graph = Graph(metadata=GraphMetadata(name="My Graph"))
    script = generate_runner_script(graph)
    assert "def main" in script
    assert "execute_graph" in script


def test_generate_deployment_bundle_keys():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import Graph, GraphMetadata
    from app.services.deploy_service import generate_deployment_bundle

    graph = Graph(metadata=GraphMetadata(name="Test Bundle"))
    bundle = generate_deployment_bundle(graph)
    assert set(bundle.keys()) == {"graph.json", "docker-compose.yml", "run_graph.py"}
