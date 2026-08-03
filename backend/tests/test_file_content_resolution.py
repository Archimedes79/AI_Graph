"""
Tests for the opt-in `config.read_file_inputs` mechanism: code/ai nodes can
declare a file_path-typed input port and receive the file's *content*
(text or base64-encoded binary, per the port's declared `format`) instead of
the raw path string.

Fixture directory: created fresh under pytest's tmp_path for each test,
containing text1.md ("bla bla\n\n") and text2.md ("bla bla bla\n\n").
"""

from __future__ import annotations

import base64
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


def _text_dir(tmp_path: Path) -> Path:
    """Create the text1.md/text2.md fixture files under tmp_path."""
    d = tmp_path / "text_fixture"
    d.mkdir()
    (d / "text1.md").write_text("bla bla\n\n", encoding="utf-8")
    (d / "text2.md").write_text("bla bla bla\n\n", encoding="utf-8")
    return d


def _resolve_test_dir(tmp_path: Path) -> str:
    return str(_text_dir(tmp_path))


CODE_ECHO_CONTENT = (
    "def run(inputs):\n"
    "    return {'content': inputs.get('paths', '')}\n"
)


def _dir_to_code_graph(test_dir: str) -> Graph:
    return Graph(
        metadata=GraphMetadata(name="Dir->Code(read_file_inputs)"),
        nodes=[
            GraphNode(
                id="dir", node_type=NodeType.INPUT, label="Dir",
                outputs=[
                    Port(id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True),
                ],
                config=NodeConfig(input_mode="directory", value=test_dir, select_all_files=True),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="EchoContent",
                inputs=[Port(id="paths", name="Paths", kind=PortKind.INPUT, data_type=DataType.FILE_PATH, multi=True)],
                outputs=[Port(id="content", name="Content", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True)],
                config=NodeConfig(code=CODE_ECHO_CONTENT, read_file_inputs=True),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="dir", source_port_id="files", target_node_id="code", target_port_id="paths"),
        ],
    )


@pytest.mark.asyncio
async def test_code_node_receives_file_content_not_paths(tmp_path):
    test_dir = _resolve_test_dir(tmp_path)
    graph = _dir_to_code_graph(test_dir)

    result = await execute_graph(graph)
    assert result.status == "success"

    code_result = next(r for r in result.node_results if r.node_id == "code")
    contents = code_result.outputs["content"]
    assert isinstance(contents, list)
    assert set(contents) == {"bla bla\n\n", "bla bla bla\n\n"}


@pytest.mark.asyncio
async def test_node_results_expose_resolved_inputs_and_whole_list_receives_list(tmp_path):
    test_dir = _resolve_test_dir(tmp_path)
    graph = Graph(
        metadata=GraphMetadata(name="Dir->Read File->Count whole list"),
        nodes=[
            GraphNode(
                id="dir", node_type=NodeType.INPUT, label="Directory",
                outputs=[
                    Port(id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True),
                ],
                config=NodeConfig(input_mode="directory", value=test_dir, select_all_files=True),
            ),
            GraphNode(
                id="read", node_type=NodeType.CODE, label="Read File",
                inputs=[Port(id="paths", name="Paths", kind=PortKind.INPUT, data_type=DataType.FILE_PATH, multi=True)],
                outputs=[Port(id="content", name="Content", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True)],
                config=NodeConfig(
                    code="def run(inputs):\n    return {'content': inputs.get('paths', [])}\n",
                    read_file_inputs=True,
                    batch_mode="whole_list",
                ),
            ),
            GraphNode(
                id="count", node_type=NodeType.CODE, label="Count bla",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.ANY)],
                config=NodeConfig(
                    code=(
                        "def run(inputs):\n"
                        "    texts = inputs.get('input', [])\n"
                        "    return {'output': sum(text.count('bla') for text in texts)}\n"
                    ),
                    batch_mode="whole_list",
                ),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="dir", source_port_id="files", target_node_id="read", target_port_id="paths"),
            GraphEdge(id="e2", source_node_id="read", source_port_id="content", target_node_id="count", target_port_id="input"),
        ],
    )

    result = await execute_graph(graph)

    assert result.status == "success"
    results = {node_result.node_id: node_result for node_result in result.node_results}
    expected_contents = {"bla bla\n\n", "bla bla bla\n\n"}
    assert results["dir"].inputs == {}
    assert set(results["read"].inputs["paths"]) == expected_contents
    assert isinstance(results["count"].inputs["input"], list)
    assert set(results["count"].inputs["input"]) == expected_contents
    assert results["count"].outputs["output"] == 5


@pytest.mark.asyncio
async def test_ai_node_receives_file_content_not_paths(tmp_path, monkeypatch):
    test_dir = _resolve_test_dir(tmp_path)

    recorded_prompts = []

    async def fake_complete(prompt, system, model, temperature, provider):
        recorded_prompts.append(prompt)
        return "ok"

    monkeypatch.setattr("app.services.graph_executor.ai_service.complete", fake_complete)

    graph = Graph(
        metadata=GraphMetadata(name="Dir->AI(read_file_inputs)"),
        nodes=[
            GraphNode(
                id="dir", node_type=NodeType.INPUT, label="Dir",
                outputs=[
                    Port(id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True),
                ],
                config=NodeConfig(input_mode="directory", value=test_dir, select_all_files=True),
            ),
            GraphNode(
                id="ai", node_type=NodeType.AI, label="Summarize",
                inputs=[Port(id="paths", name="Paths", kind=PortKind.INPUT, data_type=DataType.FILE_PATH, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True)],
                config=NodeConfig(read_file_inputs=True),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="dir", source_port_id="files", target_node_id="ai", target_port_id="paths"),
        ],
    )

    result = await execute_graph(graph)
    assert result.status == "success"

    assert len(recorded_prompts) == 2
    assert any("bla bla bla" in p for p in recorded_prompts)
    assert any(p == "bla bla\n\n" for p in recorded_prompts)
    # The raw path must never have been forwarded as the prompt.
    for p in recorded_prompts:
        assert test_dir not in p


@pytest.mark.asyncio
async def test_binary_file_round_trip_via_base64(tmp_path):
    original_bytes = b"\x00\x01\x02binarydata"
    binary_path = tmp_path / "blob.bin"
    binary_path.write_bytes(original_bytes)

    graph = Graph(
        metadata=GraphMetadata(name="Binary round-trip"),
        nodes=[
            GraphNode(
                id="input", node_type=NodeType.INPUT, label="PathInput",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                config=NodeConfig(value=str(binary_path)),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="Echo",
                inputs=[
                    Port(
                        id="blob", name="Blob", kind=PortKind.INPUT,
                        data_type=DataType.FILE_PATH, multi=False, format="application/octet-stream",
                    ),
                ],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                config=NodeConfig(
                    code="def run(inputs):\n    return {'output': inputs.get('blob', '')}\n",
                    read_file_inputs=True,
                ),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="input", source_port_id="output", target_node_id="code", target_port_id="blob"),
        ],
    )

    result = await execute_graph(graph)
    assert result.status == "success"

    code_result = next(r for r in result.node_results if r.node_id == "code")
    encoded = code_result.outputs["output"]
    if isinstance(encoded, list):
        encoded = encoded[0]
    assert base64.b64decode(encoded) == original_bytes


@pytest.mark.asyncio
async def test_read_file_inputs_off_by_default_keeps_raw_path(tmp_path):
    file_path = tmp_path / "text1.md"
    file_path.write_text("bla bla\n\n", encoding="utf-8")

    graph = Graph(
        metadata=GraphMetadata(name="read_file_inputs off (regression)"),
        nodes=[
            GraphNode(
                id="input", node_type=NodeType.INPUT, label="PathInput",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                config=NodeConfig(value=str(file_path)),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="EchoPath",
                inputs=[Port(id="path", name="Path", kind=PortKind.INPUT, data_type=DataType.FILE_PATH, multi=False)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                config=NodeConfig(code="def run(inputs):\n    return {'output': inputs.get('path', '')}\n"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="input", source_port_id="output", target_node_id="code", target_port_id="path"),
        ],
    )

    result = await execute_graph(graph)
    assert result.status == "success"

    code_result = next(r for r in result.node_results if r.node_id == "code")
    output = code_result.outputs["output"]
    if isinstance(output, list):
        output = output[0]
    assert output == str(file_path)


# ---------------------------------------------------------------------------
# Cross-edge format inheritance (upstream port format applies when the
# downstream input port doesn't declare its own).
# ---------------------------------------------------------------------------

def _binary_safe_dir(tmp_path: Path) -> Path:
    """Write fixture files with raw bytes so base64 round-trips are exact (no newline translation)."""
    d = tmp_path / "binary_fixture"
    d.mkdir()
    (d / "text1.md").write_bytes(b"bla bla\n\n")
    (d / "text2.md").write_bytes(b"bla bla bla\n\n")
    return d


def _dir_to_code_graph_with_formats(test_dir: str, source_format: str, target_format: str) -> Graph:
    return Graph(
        metadata=GraphMetadata(name="Dir->Code(format inheritance)"),
        nodes=[
            GraphNode(
                id="dir", node_type=NodeType.INPUT, label="Dir",
                outputs=[
                    Port(
                        id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH,
                        multi=True, format=source_format,
                    ),
                ],
                config=NodeConfig(input_mode="directory", value=test_dir, select_all_files=True),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="EchoContent",
                inputs=[
                    Port(
                        id="paths", name="Paths", kind=PortKind.INPUT, data_type=DataType.FILE_PATH,
                        multi=True, format=target_format,
                    ),
                ],
                outputs=[Port(id="content", name="Content", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=True)],
                config=NodeConfig(code=CODE_ECHO_CONTENT, read_file_inputs=True),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="dir", source_port_id="files", target_node_id="code", target_port_id="paths"),
        ],
    )


@pytest.mark.asyncio
async def test_downstream_inherits_upstream_binary_format_when_unset(tmp_path):
    """Source port declares format="binary"; downstream port has no format -> base64 content."""
    test_dir = str(_binary_safe_dir(tmp_path))
    graph = _dir_to_code_graph_with_formats(test_dir, source_format="binary", target_format="")

    result = await execute_graph(graph)
    assert result.status == "success"

    code_result = next(r for r in result.node_results if r.node_id == "code")
    contents = code_result.outputs["content"]
    assert isinstance(contents, list)
    decoded = {base64.b64decode(c).decode("utf-8") for c in contents}
    assert decoded == {"bla bla\n\n", "bla bla bla\n\n"}


@pytest.mark.asyncio
async def test_downstream_explicit_format_overrides_upstream(tmp_path):
    """Source declares format="text" but downstream explicitly sets "binary" -> explicit override wins."""
    test_dir = str(_binary_safe_dir(tmp_path))
    graph = _dir_to_code_graph_with_formats(test_dir, source_format="text", target_format="binary")

    result = await execute_graph(graph)
    assert result.status == "success"

    code_result = next(r for r in result.node_results if r.node_id == "code")
    contents = code_result.outputs["content"]
    assert isinstance(contents, list)
    decoded = {base64.b64decode(c).decode("utf-8") for c in contents}
    assert decoded == {"bla bla\n\n", "bla bla bla\n\n"}


@pytest.mark.asyncio
async def test_downstream_inherits_upstream_json_format_when_unset():
    """Source output port declares format="json"; downstream input has no format -> value is JSON-decoded."""
    graph = Graph(
        metadata=GraphMetadata(name="Text->Code(json format inheritance)"),
        nodes=[
            GraphNode(
                id="input", node_type=NodeType.INPUT, label="JsonInput",
                outputs=[
                    Port(
                        id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT,
                        multi=False, format="json",
                    ),
                ],
                config=NodeConfig(value='{"a": 1, "b": [1, 2, 3]}'),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="EchoData",
                inputs=[Port(id="data", name="Data", kind=PortKind.INPUT, data_type=DataType.TEXT, multi=False)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                config=NodeConfig(
                    code="def run(inputs):\n    return {'output': inputs.get('data')}\n",
                    batch_mode="whole_list",
                ),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="input", source_port_id="output", target_node_id="code", target_port_id="data"),
        ],
    )

    result = await execute_graph(graph)
    assert result.status == "success"

    code_result = next(r for r in result.node_results if r.node_id == "code")
    assert code_result.outputs["output"] == {"a": 1, "b": [1, 2, 3]}
