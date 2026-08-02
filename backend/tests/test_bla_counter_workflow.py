"""
Workflow-level test for the directory-scan "bla counter" example graph
(examples/test_bla_counter.json): input(directory) -> code(whole_list,
read_file_inputs) -> text_output, executed in-process via execute_graph.

Fixture: e:\\test\\text1.md ("bla bla" -> 2) and e:\\test\\text2.md
("bla bla bla" -> 3), combined bla_count == 5. No live AI provider is used --
the code node's `run()` was pre-generated (see examples/test_bla_counter.json)
and is embedded directly in the graph, matching the pattern in
test_directory_to_code_forwarding.py.
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
    NodeConfig,
    NodeType,
    Port,
    PortKind,
)
from app.services.graph_executor import execute_graph  # noqa: E402

TEST_DIR = r"e:\test"

BLA_COUNTER_CODE = (
    "def run(inputs):\n"
    "    files = inputs['files']\n"
    "    combined_text = ' '.join(files)\n"
    "    summary = combined_text[:100] + (\"...\" if len(combined_text) > 100 else \"\")\n"
    "    bla_count = combined_text.lower().count('bla')\n"
    "    return {'summary': summary, 'bla_count': bla_count}\n"
)


def _bla_counter_graph() -> Graph:
    return Graph(
        metadata=GraphMetadata(name="Directory Bla Counter"),
        nodes=[
            GraphNode(
                id="node-input-1", node_type=NodeType.INPUT, label="Test Files",
                outputs=[
                    Port(id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True),
                    Port(id="count", name="Count", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False),
                ],
                config=NodeConfig(
                    value=TEST_DIR, input_mode="directory", select_all_files=True,
                    extra={"extensions": ".md"},
                ),
            ),
            GraphNode(
                id="node-code-1", node_type=NodeType.CODE, label="Count Bla",
                inputs=[Port(id="files", name="Files", kind=PortKind.INPUT, data_type=DataType.FILE_PATH, multi=True)],
                outputs=[
                    Port(id="summary", name="Summary", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False),
                    Port(id="bla_count", name="Bla Count", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False),
                ],
                config=NodeConfig(
                    read_file_inputs=True, batch_mode="whole_list", code=BLA_COUNTER_CODE,
                ),
            ),
            GraphNode(
                id="node-textoutput-1", node_type=NodeType.TEXT_OUTPUT, label="Result",
                inputs=[
                    Port(id="summary", name="Summary", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=False),
                    Port(id="bla_count", name="Bla Count", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=False),
                ],
                config=NodeConfig(output_label="Bla Counter Result"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="node-input-1", source_port_id="files", target_node_id="node-code-1", target_port_id="files"),
            GraphEdge(id="e2", source_node_id="node-code-1", source_port_id="summary", target_node_id="node-textoutput-1", target_port_id="summary"),
            GraphEdge(id="e3", source_node_id="node-code-1", source_port_id="bla_count", target_node_id="node-textoutput-1", target_port_id="bla_count"),
        ],
    )


@pytest.mark.asyncio
async def test_directory_bla_counter_workflow_executes_end_to_end():
    assert Path(TEST_DIR).is_dir(), f"fixture directory {TEST_DIR} must exist"

    graph = _bla_counter_graph()
    result = await execute_graph(graph)

    assert result.status == "success"

    final = result.final_outputs["Bla Counter Result"]
    assert final["bla_count"] == 5
    assert isinstance(final["summary"], str) and final["summary"]
