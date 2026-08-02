"""Workflow test for the bla-counter example graph."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import Graph, NodeType  # noqa: E402
from app.services.graph_executor import execute_graph  # noqa: E402

@pytest.mark.asyncio
async def test_directory_bla_counter_workflow_executes_end_to_end(tmp_path: Path):
    (tmp_path / "text1.md").write_text("bla bla", encoding="utf-8")
    (tmp_path / "text2.md").write_text("bla bla bla", encoding="utf-8")

    example_path = Path(__file__).parents[2] / "examples" / "test_bla_counter.json"
    graph = Graph.model_validate_json(example_path.read_text(encoding="utf-8"))
    input_node = next(node for node in graph.nodes if node.node_type == NodeType.INPUT)
    input_node.config.value = str(tmp_path)

    result = await execute_graph(graph)

    assert result.status == "success"
    final = result.final_outputs["Bla Counter Result"]
    assert final["bla_count"] == 5
    assert isinstance(final["summary"], str) and final["summary"]
