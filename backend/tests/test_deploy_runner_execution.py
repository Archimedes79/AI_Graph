"""
End-to-end execution tests for the deploy bundle.

Builds a REAL deploy bundle for a representative graph (writing the vendored
`app/` package, `graph.json`, `main.py`, and `requirements.txt` to a temp
directory) and runs `main.py` as an actual python subprocess -- exactly what a
deployed user would do -- then compares its printed JSON result against
`execute_graph()` run in-process for the identical graph. The bundle ships the
real engine verbatim, so the two must always agree; there is no separate
codegen path that could silently drift.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import (
    DataType, Graph, GraphEdge, GraphMetadata, GraphNode, GuiWidget, GuiWidgetKind,
    NodeConfig, NodeType, Port, PortKind, sync_gui_node_ports,
)
from app.services.deploy_service import generate_deployment_bundle
from app.services.graph_executor import execute_graph


def _write_bundle(root: Path, graph: Graph) -> Path:
    """Materialize generate_deployment_bundle(graph)'s files under *root*."""
    for rel_path, content in generate_deployment_bundle(graph).items():
        dest = root / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")
    return root


def _run_bundle(bundle_dir: Path, stdin_answers: list[str]) -> dict:
    """Run the bundle's main.py as a real subprocess from within *bundle_dir*
    (exactly how a deployed user would -- no PYTHONPATH/sys.path tricks) and
    return the parsed ExecutionResult JSON it printed on stdout."""
    stdin_text = "".join(f"{answer}\n" for answer in stdin_answers)
    result = subprocess.run(
        [sys.executable, "main.py"],
        cwd=bundle_dir,
        input=stdin_text,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, f"stderr:\n{result.stderr}\nstdout:\n{result.stdout}"
    # stdout may also contain the (un-newlined) runtime-requirement prompts;
    # the final JSON dump is the only thing that starts with '{'.
    json_start = result.stdout.index("{")
    return json.loads(result.stdout[json_start:])


def _text_to_code_to_output_graph() -> Graph:
    text_input = GraphNode(
        id="text", node_type=NodeType.INPUT, label="Source Text",
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(value="hello from ai-graph!", prompt_at_runtime=True),
    )
    code = GraphNode(
        id="code", node_type=NodeType.CODE, label="Uppercase",
        inputs=[Port(id="input", name="Input", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.ANY)],
        config=NodeConfig(code="def run(inputs):\n    return {'output': str(inputs.get('input', '')).upper()}\n"),
    )
    output = GraphNode(
        id="out", node_type=NodeType.OUTPUT, label="Out",
        inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
        config=NodeConfig(output_label="Result"),
    )
    return Graph(
        metadata=GraphMetadata(name="Text-to-Code-to-Output Workflow"),
        nodes=[text_input, code, output],
        edges=[
            GraphEdge(id="e1", source_node_id="text", source_port_id="output", target_node_id="code", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="code", source_port_id="output", target_node_id="out", target_port_id="value"),
        ],
    )


async def test_deploy_bundle_matches_live_execution_for_text_to_code_workflow(tmp_path):
    """text_input -> code (uppercase) -> output: the bundled main.py, run for
    real, must produce the same final_outputs as an in-process execute_graph()
    call for the identical graph."""
    graph = _text_to_code_to_output_graph()

    live_result = await execute_graph(graph)

    bundle_dir = _write_bundle(tmp_path / "bundle", graph)
    # text_input always prompts at runtime; an empty answer falls back to its
    # preset config.value, matching what execute_graph() used directly above.
    bundled_output = _run_bundle(bundle_dir, [""])

    assert bundled_output["status"] == "success"
    assert live_result.status.value == "success"
    assert bundled_output["final_outputs"] == live_result.final_outputs
    assert bundled_output["final_outputs"]["Result"]["value"] == "HELLO FROM AI-GRAPH!"


def _gui_workflow_graph(fixture_path: Path) -> Graph:
    gui = GraphNode(
        id="gui", node_type=NodeType.GUI, label="GUI",
        config=NodeConfig(gui_widgets=[
            GuiWidget(id="w1", kind=GuiWidgetKind.INPUT_PICKER, mode="file", label="File", value=str(fixture_path)),
            GuiWidget(id="w2", kind=GuiWidgetKind.TEXT_IO, label="Text", value="text-window-value-99"),
        ]),
    )
    sync_gui_node_ports(gui)

    reader = GraphNode(
        id="reader", node_type=NodeType.CODE, label="Read File",
        inputs=[Port(id="path", name="Path", kind=PortKind.INPUT, data_type=DataType.FILE_PATH, multi=False, required=False)],
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(code="def run(inputs):\n    return {'output': inputs['path']}\n", read_file_inputs=True),
    )
    merge = GraphNode(
        id="merge", node_type=NodeType.CODE, label="Merge",
        inputs=[Port(id="inputs", name="Inputs", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)],
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(
            code="def run(inputs):\n"
                 "    return {'output': '\\n'.join(str(v) for v in inputs.get('inputs', []) if v is not None)}\n",
            batch_mode="whole_list",
        ),
    )
    output = GraphNode(
        id="out", node_type=NodeType.OUTPUT, label="Out",
        inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
        config=NodeConfig(output_label="Result"),
    )

    return Graph(
        metadata=GraphMetadata(name="GUI Workflow"),
        nodes=[gui, reader, merge, output],
        edges=[
            GraphEdge(id="e1", source_node_id="gui", source_port_id="w1_out", target_node_id="reader", target_port_id="path"),
            GraphEdge(id="e2", source_node_id="reader", source_port_id="output", target_node_id="merge", target_port_id="inputs"),
            GraphEdge(id="e3", source_node_id="gui", source_port_id="w2_out", target_node_id="merge", target_port_id="inputs"),
            GraphEdge(id="e4", source_node_id="merge", source_port_id="output", target_node_id="out", target_port_id="value"),
        ],
    )


async def test_deploy_bundle_matches_live_execution_for_gui_workflow(tmp_path):
    """gui (file_open + text_window widgets) -> code (reads the file's real
    content) -> code (merge) -> output: the bundled main.py, run for real,
    must read the actual file content and match execute_graph()'s output for
    the identical graph -- both widgets have preset values, so main.py never
    needs to prompt."""
    fixture = tmp_path / "note.txt"
    fixture.write_text("fixture-file-content-42", encoding="utf-8")
    graph = _gui_workflow_graph(fixture)

    live_result = await execute_graph(graph)

    bundle_dir = _write_bundle(tmp_path / "bundle", graph)
    bundled_output = _run_bundle(bundle_dir, [])

    assert bundled_output["final_outputs"] == live_result.final_outputs
    merged = bundled_output["final_outputs"]["Result"]["value"]
    assert "fixture-file-content-42" in merged
    assert "text-window-value-99" in merged


def test_deploy_bundle_layout(tmp_path):
    """The bundle's file layout matches AGENTS.md's documented structure --
    a vendored app/ package alongside graph.json/main.py/requirements.txt,
    not a monolithic generated script."""
    graph = _text_to_code_to_output_graph()
    bundle = generate_deployment_bundle(graph)

    assert "graph.json" in bundle
    assert "main.py" in bundle
    assert "requirements.txt" in bundle
    assert "app/elements/base.py" in bundle
    assert "app/elements/registry.py" in bundle
    assert "app/elements/code/code_element.py" in bundle
    assert "app/models/graph.py" in bundle
    assert "app/services/graph_executor.py" in bundle
    # Server-only modules must never be vendored into the bundle.
    assert "app/services/deploy_service.py" not in bundle
    assert not any(path.startswith("app/routers/") for path in bundle)
    assert json.loads(bundle["graph.json"])["metadata"]["name"] == graph.metadata.name

