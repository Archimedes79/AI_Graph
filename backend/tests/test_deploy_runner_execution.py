"""
End-to-end execution tests for the deploy compiler.

Unlike test_graph.py's deploy tests (which only assert on the generated
script's *source text*), these tests actually WRITE the compiled script to
disk and RUN it as a real python subprocess, then parse its stdout JSON and
check the real computed values.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def _run_compiled_script(tmp_path: Path, script: str, stdin_answers: list[str]) -> dict:
    """Write *script* to a temp file and run it as a real subprocess, feeding
    *stdin_answers* (one line per runtime-requirement prompt) via stdin, then
    return the parsed final-outputs JSON the script printed on stdout."""
    script_path = tmp_path / "compiled_runner.py"
    script_path.write_text(script, encoding="utf-8")
    stdin_text = "".join(f"{answer}\n" for answer in stdin_answers)
    result = subprocess.run(
        [sys.executable, str(script_path)],
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


def test_compiled_runner_executes_text_to_code_to_output_workflow(tmp_path):
    """text_input -> code (uppercase) -> output: run the compiled script for
    real, feeding the text_input's runtime prompt via stdin, and check the
    actually-computed uppercased output."""
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import (
        Graph, GraphEdge, GraphMetadata, GraphNode, NodeConfig, NodeType, Port, PortKind, DataType,
    )
    from app.services.deploy_service import generate_runner_script

    text_input = GraphNode(
        id="text", node_type=NodeType.TEXT_INPUT, label="Source Text",
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(value="placeholder"),
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
    graph = Graph(
        metadata=GraphMetadata(name="Text-to-Code-to-Output Workflow"),
        nodes=[text_input, code, output],
        edges=[
            GraphEdge(id="e1", source_node_id="text", source_port_id="output", target_node_id="code", target_port_id="input"),
            GraphEdge(id="e2", source_node_id="code", source_port_id="output", target_node_id="out", target_port_id="value"),
        ],
    )

    script = generate_runner_script(graph)
    final_outputs = _run_compiled_script(tmp_path, script, ["hello from ai-graph!"])

    # code nodes run in (default) per-item batch mode, which always wraps
    # results in a list -- even for a single, non-list input.
    assert final_outputs["Result"]["value"] == ["HELLO FROM AI-GRAPH!"]


def test_compiled_runner_executes_gui_workflow(tmp_path):
    """gui (file_open + text_window widgets) -> code (reads the file's real
    content) -> merge -> output: run the compiled script for real and check
    that both the file's actual content and the text_window's text reach the
    final output."""
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from app.models.graph import (
        Graph, GraphEdge, GraphMetadata, GraphNode, GuiWidget, GuiWidgetKind,
        NodeConfig, NodeType, Port, PortKind, DataType, sync_gui_node_ports,
    )
    from app.services.deploy_service import generate_runner_script

    fixture = tmp_path / "note.txt"
    fixture.write_text("fixture-file-content-42", encoding="utf-8")

    gui = GraphNode(
        id="gui", node_type=NodeType.GUI, label="GUI",
        config=NodeConfig(gui_widgets=[
            GuiWidget(id="w1", kind=GuiWidgetKind.FILE_OPEN, label="File", value=str(fixture)),
            GuiWidget(id="w2", kind=GuiWidgetKind.TEXT_WINDOW, label="Text", value="text-window-value-99"),
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
        id="merge", node_type=NodeType.MERGE, label="Merge",
        inputs=[Port(id="inputs", name="Inputs", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)],
        outputs=[Port(id="output", name="Output", kind=PortKind.OUTPUT, data_type=DataType.TEXT)],
        config=NodeConfig(separator="\n"),
    )
    output = GraphNode(
        id="out", node_type=NodeType.OUTPUT, label="Out",
        inputs=[Port(id="value", name="Value", kind=PortKind.INPUT, data_type=DataType.ANY, multi=True)],
        config=NodeConfig(output_label="Result"),
    )

    graph = Graph(
        metadata=GraphMetadata(name="GUI Workflow"),
        nodes=[gui, reader, merge, output],
        edges=[
            GraphEdge(id="e1", source_node_id="gui", source_port_id="w1_out", target_node_id="reader", target_port_id="path"),
            GraphEdge(id="e2", source_node_id="reader", source_port_id="output", target_node_id="merge", target_port_id="inputs"),
            GraphEdge(id="e3", source_node_id="gui", source_port_id="w2_out", target_node_id="merge", target_port_id="inputs"),
            GraphEdge(id="e4", source_node_id="merge", source_port_id="output", target_node_id="out", target_port_id="value"),
        ],
    )

    script = generate_runner_script(graph)
    final_outputs = _run_compiled_script(tmp_path, script, [])

    merged = final_outputs["Result"]["value"]
    assert "fixture-file-content-42" in merged
    assert "text-window-value-99" in merged
