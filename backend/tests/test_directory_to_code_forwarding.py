"""
Reproduction tests for the reported "directory -> code -> merge/output forwarding"
bug. These call app.services.graph_executor.execute_graph directly, mirroring the
patterns in test_graph.py (test_ai_node_processes_each_batch_item,
test_code_node_processes_each_batch_item). No live AI provider is used.

Fixture directory: created fresh under pytest's tmp_path for each test, containing
text1.md ("bla bla" -> 2) and text2.md ("bla bla bla" -> 3).
"""

from __future__ import annotations

import json
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


def _make_fixture_dir(tmp_path: Path) -> str:
    """Create the text1.md/text2.md fixture files inside tmp_path."""
    (tmp_path / "text1.md").write_text("bla bla", encoding="utf-8")
    (tmp_path / "text2.md").write_text("bla bla bla", encoding="utf-8")
    return str(tmp_path)


COUNT_CODE = (
    "def run(inputs):\n"
    "    path = inputs.get('input', '')\n"
    "    with open(path, 'r', encoding='utf-8') as f:\n"
    "        text = f.read()\n"
    "    return {'count': text.count('bla'), 'path': path}\n"
)

SUM_CODE = (
    "def run(inputs):\n"
    "    items = inputs.get('input', [])\n"
    "    return {'total': sum(i['count'] for i in items)}\n"
)


def _dump(label, result):
    print(f"\n===== {label} =====")
    print("status:", result.status)
    for r in result.node_results:
        print(f"  node={r.node_id} status={r.status} outputs={r.outputs} error={r.error}")
    print("final_outputs:", result.final_outputs)


# ---------------------------------------------------------------------------
# Scenario 1/2: Directory -> Code(count) -> Merge  AND  Directory -> Code(count) -> Output
# ---------------------------------------------------------------------------

def _dir_to_code_graph(*, code: str, downstream_source_port: str, test_dir: str) -> Graph:
    return Graph(
        metadata=GraphMetadata(name="Dir->Code->Merge/Output"),
        nodes=[
            GraphNode(
                id="dir", node_type=NodeType.DIRECTORY_INPUT, label="Dir",
                outputs=[
                    Port(id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True),
                    Port(id="count", name="Count", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False),
                ],
                config=NodeConfig(value=test_dir, select_all_files=True),
            ),
            GraphNode(
                id="dirDirect", node_type=NodeType.DIRECTORY_INPUT, label="DirDirect",
                outputs=[
                    Port(id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True),
                    Port(id="count", name="Count", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False),
                ],
                config=NodeConfig(value=test_dir, select_all_files=True),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="CountBla",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(code=code),
            ),
            GraphNode(
                id="codeDirect", node_type=NodeType.CODE, label="CountBlaDirect",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(code=code),
            ),
            GraphNode(
                id="merge", node_type=NodeType.MERGE, label="Merge",
                inputs=[Port(id="inputs", name="Inputs", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                config=NodeConfig(separator=" "),
            ),
            GraphNode(
                id="mergeOut", node_type=NodeType.OUTPUT, label="MergeOut",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(output_label="MergeResult"),
            ),
            GraphNode(
                id="directOut", node_type=NodeType.OUTPUT, label="DirectOut",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(output_label="DirectResult"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="dir", source_port_id="files", target_node_id="code", target_port_id="input"),
            GraphEdge(id="e1b", source_node_id="dirDirect", source_port_id="files", target_node_id="codeDirect", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="code", source_port_id=downstream_source_port, target_node_id="merge", target_port_id="inputs"),
            GraphEdge(id="e3", source_node_id="merge", source_port_id="output", target_node_id="mergeOut", target_port_id="value"),
            GraphEdge(id="e4", source_node_id="codeDirect", source_port_id=downstream_source_port, target_node_id="directOut", target_port_id="value"),
        ],
    )


@pytest.mark.asyncio
async def test_directory_to_code_to_merge_and_output_as_specified_in_task(tmp_path):
    """
    Wires edges to the code node's declared "output" port id (the only port the
    frontend UI can offer, per nodeDefaults.ts), while the hand-written function
    returns keys "count"/"path" (exactly as specified in the task description).

    This is the fix-#1 regression test: since the code node declares exactly one
    output port ("output") and the returned keys don't match it, the raw result
    is now wrapped as {"output": result} instead of being silently dropped.
    """
    test_dir = _make_fixture_dir(tmp_path)
    graph = _dir_to_code_graph(code=COUNT_CODE, downstream_source_port="output", test_dir=test_dir)

    result = await execute_graph(graph)
    _dump("Scenario 1/2 (as specified): Dir->Code->Merge & Dir->Code->Output", result)

    assert result.status == "success"

    code_result = next(r for r in result.node_results if r.node_id == "code")
    # Mismatched keys ("count"/"path") are now wrapped under the sole declared
    # output port id ("output") instead of being silently dropped.
    assert "output" in code_result.outputs
    counts = sorted(item["count"] for item in code_result.outputs["output"])
    assert counts == [2, 3]

    merged_value = result.final_outputs["MergeResult"]["value"]
    direct_value = result.final_outputs["DirectResult"]["value"]
    print("LITERAL MERGED STRING (fixed forwarding):", repr(merged_value))
    print("LITERAL DIRECT OUTPUT VALUE (fixed forwarding):", repr(direct_value))

    # FIX VERIFIED: the count/path data is no longer lost -- it reaches both the
    # direct Output node and the Merge node (concat mode string-joins the dicts).
    assert direct_value is not None
    assert sorted(item["count"] for item in direct_value) == [2, 3]
    assert "2" in merged_value and "3" in merged_value


@pytest.mark.asyncio
async def test_directory_to_code_to_merge_and_output_with_matching_port_name(tmp_path):
    """
    Same graph, but the function returns {"output": {...}} so the key matches the
    wired port id. Confirms the merge-vs-sum behavior described in task point 2.
    """
    code = (
        "def run(inputs):\n"
        "    path = inputs.get('input', '')\n"
        "    with open(path, 'r', encoding='utf-8') as f:\n"
        "        text = f.read()\n"
        "    return {'output': {'count': text.count('bla'), 'path': path}}\n"
    )
    test_dir = _make_fixture_dir(tmp_path)
    graph = _dir_to_code_graph(code=code, downstream_source_port="output", test_dir=test_dir)

    result = await execute_graph(graph)
    _dump("Scenario 1/2 (matching port name): Dir->Code->Merge & Dir->Code->Output", result)

    assert result.status == "success"

    code_result = next(r for r in result.node_results if r.node_id == "code")
    counts = sorted(item["count"] for item in code_result.outputs["output"])
    assert counts == [2, 3]

    merged_value = result.final_outputs["MergeResult"]["value"]
    print("LITERAL MERGED STRING:", repr(merged_value))

    # Merge does NOT sum counts to 5; it string-joins Python dict reprs.
    # (Checking for a bare "5" is unreliable: tmp_path embeds pytest's rotating
    # "pytest-NN" temp-dir counter, which coincidentally contains "5" on many
    # runs, so assert on the specific summed-value shape instead.)
    assert "'count': 5" not in merged_value
    assert "{'count'" in merged_value


# ---------------------------------------------------------------------------
# Scenario 3: Text Input -> Code (uppercase) -> Output  (regression check, non-batch source)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_text_input_to_code_to_output_regression():
    graph = Graph(
        metadata=GraphMetadata(name="Text->Code->Output"),
        nodes=[
            GraphNode(
                id="input", node_type=NodeType.TEXT_INPUT, label="Input",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                config=NodeConfig(value="hello world"),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="Upper",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(code="def run(inputs):\n    return {'output': inputs.get('input', '').upper()}\n"),
            ),
            GraphNode(
                id="out", node_type=NodeType.OUTPUT, label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(output_label="UpperResult"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="input", source_port_id="output", target_node_id="code", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="code", source_port_id="output", target_node_id="out", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    _dump("Scenario 3: Text->Code->Output (regression)", result)

    assert result.status == "success"
    assert result.final_outputs["UpperResult"]["value"] == ["HELLO WORLD"]


# ---------------------------------------------------------------------------
# Scenario 4: Directory -> Code(count) -> Code(sum) - the suspected "reduce" bug
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_directory_to_code_to_second_code_reduce_is_batched_not_reduced(tmp_path):
    test_dir = _make_fixture_dir(tmp_path)
    graph = Graph(
        metadata=GraphMetadata(name="Dir->Code->Code(sum)"),
        nodes=[
            GraphNode(
                id="dir", node_type=NodeType.DIRECTORY_INPUT, label="Dir",
                outputs=[
                    Port(id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True),
                    Port(id="count", name="Count", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False),
                ],
                config=NodeConfig(value=test_dir, select_all_files=True),
            ),
            GraphNode(
                id="code1", node_type=NodeType.CODE, label="CountBla",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(code=COUNT_CODE),
            ),
            GraphNode(
                id="code2", node_type=NodeType.CODE, label="SumBla",
                # multi=True on this input port is the crux of the hypothesis under test.
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(code=SUM_CODE),
            ),
            GraphNode(
                id="out", node_type=NodeType.OUTPUT, label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(output_label="SumResult"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="dir", source_port_id="files", target_node_id="code1", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="code1", source_port_id="output", target_node_id="code2", target_port_id="input"),
            GraphEdge(id="e3", source_node_id="code2", source_port_id="output", target_node_id="out", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    _dump("Scenario 4: Dir->Code(count)->Code(sum) reduce hypothesis", result)

    code2_result = next(r for r in result.node_results if r.node_id == "code2")

    # Hypothesis: code2's `input` port is multi=True, so _batch_inputs() expands the
    # list of {count, path} dicts into ONE run() call PER ITEM (each seeing a single
    # dict), instead of one run() call receiving the whole list. SUM_CODE calls
    # `i["count"] for i in items` where `items` is actually a single dict per call,
    # so iterating a dict yields its *keys* ("count", "path"), and `i["count"]`
    # on a string key raises a TypeError -> node status should be ERROR.
    print("code2 status:", code2_result.status, "error:", code2_result.error)
    assert code2_result.status == "error"
    assert "SumResult" not in result.final_outputs


# ---------------------------------------------------------------------------
# Fix #1: output-key reconciliation unit tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_single_output_port_code_node_wraps_mismatched_keys():
    """A code node with exactly one declared output port whose returned dict keys
    match nothing gets the whole dict wrapped under that port id, instead of the
    value silently disappearing."""
    graph = Graph(
        metadata=GraphMetadata(name="SingleOutputMismatch"),
        nodes=[
            GraphNode(
                id="input", node_type=NodeType.TEXT_INPUT, label="Input",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                config=NodeConfig(value="hello"),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="Mismatch",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(code=(
                    "def run(inputs):\n"
                    "    return {'length': len(inputs.get('input', '')), 'text': inputs.get('input', '')}\n"
                )),
            ),
            GraphNode(
                id="out", node_type=NodeType.OUTPUT, label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(output_label="Result"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="input", source_port_id="output", target_node_id="code", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="code", source_port_id="output", target_node_id="out", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    assert result.status == "success"

    code_result = next(r for r in result.node_results if r.node_id == "code")
    assert code_result.outputs["output"] == [{"length": 5, "text": "hello"}]
    assert result.final_outputs["Result"]["value"] == [{"length": 5, "text": "hello"}]


@pytest.mark.asyncio
async def test_multi_output_port_node_with_matching_keys_is_unaffected():
    """A code node with multiple declared output ports whose returned keys match
    those ports is passed through unchanged (no wrapping, no warning-driven data loss)."""
    graph = Graph(
        metadata=GraphMetadata(name="MultiOutputMatching"),
        nodes=[
            GraphNode(
                id="input", node_type=NodeType.TEXT_INPUT, label="Input",
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False)],
                config=NodeConfig(value="hello"),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="Split",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[
                    Port(id="upper", name="Upper", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=True),
                    Port(id="lower", name="Lower", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=True),
                ],
                config=NodeConfig(code=(
                    "def run(inputs):\n"
                    "    text = inputs.get('input', '')\n"
                    "    return {'upper': text.upper(), 'lower': text.lower()}\n"
                )),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="input", source_port_id="output", target_node_id="code", target_port_id="input"),
        ],
    )

    result = await execute_graph(graph)
    assert result.status == "success"

    code_result = next(r for r in result.node_results if r.node_id == "code")
    assert code_result.outputs == {"upper": ["HELLO"], "lower": ["hello"]}


# ---------------------------------------------------------------------------
# Fix #3: batch_mode="whole_list" - Directory -> per_item Code(count) ->
# whole_list Code(sum) -> Output, replicating the original bug scenario end-to-end.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_whole_list_batch_mode_reduces_counts_to_total_of_five(tmp_path):
    test_dir = _make_fixture_dir(tmp_path)
    graph = Graph(
        metadata=GraphMetadata(name="Dir->Code(count)->Code(whole_list sum)"),
        nodes=[
            GraphNode(
                id="dir", node_type=NodeType.DIRECTORY_INPUT, label="Dir",
                outputs=[Port(id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True)],
                config=NodeConfig(value=test_dir, select_all_files=True),
            ),
            GraphNode(
                id="code1", node_type=NodeType.CODE, label="CountBla",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="count", name="Count", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(code=(
                    "def run(inputs):\n"
                    "    path = inputs.get('input', '')\n"
                    "    with open(path, 'r', encoding='utf-8') as f:\n"
                    "        text = f.read()\n"
                    "    return {'count': text.count('bla')}\n"
                )),
            ),
            GraphNode(
                id="code2", node_type=NodeType.CODE, label="SumBla",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="total", name="Total", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=False)],
                config=NodeConfig(
                    batch_mode="whole_list",
                    code=(
                        "def run(inputs):\n"
                        "    items = inputs.get('input', [])\n"
                        "    return {'total': sum(items)}\n"
                    ),
                ),
            ),
            GraphNode(
                id="out", node_type=NodeType.OUTPUT, label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(output_label="SumResult"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="dir", source_port_id="files", target_node_id="code1", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="code1", source_port_id="count", target_node_id="code2", target_port_id="input"),
            GraphEdge(id="e3", source_node_id="code2", source_port_id="total", target_node_id="out", target_port_id="value"),
        ],
    )

    result = await execute_graph(graph)
    _dump("Fix #3: whole_list batch_mode reduce", result)

    assert result.status == "success"
    code1_result = next(r for r in result.node_results if r.node_id == "code1")
    assert sorted(code1_result.outputs["count"]) == [2, 3]

    code2_result = next(r for r in result.node_results if r.node_id == "code2")
    assert code2_result.outputs["total"] == 5
    assert result.final_outputs["SumResult"]["value"] == 5


# ---------------------------------------------------------------------------
# Fix #4: Merge aggregation modes.
# ---------------------------------------------------------------------------

def _dir_to_count_to_merge_graph(merge_mode: str, test_dir: str) -> Graph:
    return Graph(
        metadata=GraphMetadata(name=f"Dir->Code(count)->Merge({merge_mode})"),
        nodes=[
            GraphNode(
                id="dir", node_type=NodeType.DIRECTORY_INPUT, label="Dir",
                outputs=[Port(id="files", name="Files", kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True)],
                config=NodeConfig(value=test_dir, select_all_files=True),
            ),
            GraphNode(
                id="code", node_type=NodeType.CODE, label="CountBla",
                inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="count", name="Count", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(code=(
                    "def run(inputs):\n"
                    "    path = inputs.get('input', '')\n"
                    "    with open(path, 'r', encoding='utf-8') as f:\n"
                    "        text = f.read()\n"
                    "    return {'count': text.count('bla')}\n"
                )),
            ),
            GraphNode(
                id="merge", node_type=NodeType.MERGE, label="Merge",
                inputs=[Port(id="inputs", name="Inputs", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.ANY, multi=False)],
                config=NodeConfig(merge_mode=merge_mode),
            ),
            GraphNode(
                id="out", node_type=NodeType.OUTPUT, label="Out",
                inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
                config=NodeConfig(output_label="MergeResult"),
            ),
        ],
        edges=[
            GraphEdge(id="e1", source_node_id="dir", source_port_id="files", target_node_id="code", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="code", source_port_id="count", target_node_id="merge", target_port_id="inputs"),
            GraphEdge(id="e3", source_node_id="merge", source_port_id="output", target_node_id="out", target_port_id="value"),
        ],
    )


@pytest.mark.asyncio
async def test_merge_sum_mode_reproduces_e_test_total_of_five(tmp_path):
    test_dir = _make_fixture_dir(tmp_path)
    graph = _dir_to_count_to_merge_graph("sum", test_dir)
    result = await execute_graph(graph)
    _dump("Fix #4: Merge(sum) fixture scenario", result)

    assert result.status == "success"
    assert result.final_outputs["MergeResult"]["value"] == 5


@pytest.mark.asyncio
async def test_merge_count_mode_counts_scalar_values(tmp_path):
    test_dir = _make_fixture_dir(tmp_path)
    graph = _dir_to_count_to_merge_graph("count", test_dir)
    result = await execute_graph(graph)
    _dump("Fix #4: Merge(count)", result)

    assert result.status == "success"
    assert result.final_outputs["MergeResult"]["value"] == 2


@pytest.mark.asyncio
async def test_merge_json_list_mode_serializes_flat_list(tmp_path):
    test_dir = _make_fixture_dir(tmp_path)
    graph = _dir_to_count_to_merge_graph("json_list", test_dir)
    result = await execute_graph(graph)
    _dump("Fix #4: Merge(json_list)", result)

    assert result.status == "success"
    decoded = json.loads(result.final_outputs["MergeResult"]["value"])
    assert sorted(decoded) == [2, 3]


@pytest.mark.asyncio
async def test_merge_concat_mode_unaffected_by_new_modes(tmp_path):
    """Default merge_mode ("concat") keeps today's exact string-join behaviour."""
    test_dir = _make_fixture_dir(tmp_path)
    graph = _dir_to_code_graph(code=(
        "def run(inputs):\n"
        "    return {'output': inputs.get('input', '')}\n"
    ), downstream_source_port="output", test_dir=test_dir)

    result = await execute_graph(graph)
    assert result.status == "success"
    merged_value = result.final_outputs["MergeResult"]["value"]
    assert isinstance(merged_value, str)
