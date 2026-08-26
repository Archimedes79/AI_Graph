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

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import (
    DataType, Graph, GraphEdge, GraphMetadata, GraphNode, GuiWidget, GuiWidgetKind,
    NodeConfig, NodeType, Port, PortKind, sync_gui_node_ports,
)
from app.services import deploy_service
from app.services.deploy_service import generate_deployment_bundle
from app.services.graph_executor import execute_graph


def _write_bundle(root: Path, graph: Graph) -> Path:
    """Materialize generate_deployment_bundle(graph)'s files under *root*.
    Vendored static assets arrive as bytes; everything else as text."""
    for rel_path, content in generate_deployment_bundle(graph).items():
        dest = root / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            dest.write_bytes(content)
        else:
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

    # Both shipped scripts are repo files copied verbatim, never strings
    # assembled inside deploy_service -- the same rule that keeps the engine
    # from drifting applies to the entry point and the exe builder.
    repo_root = Path(__file__).parent.parent.parent
    assert bundle["main.py"] == (repo_root / "graph-runner" / "run.py").read_text(encoding="utf-8")
    assert bundle["build_exe.py"] == (repo_root / "graph-runner" / "build_exe.py").read_text(encoding="utf-8")
    assert "build_exe.py" in bundle["README.md"]


def test_deploy_bundle_default_graph_path_resolution(tmp_path, monkeypatch):
    """
    A one-file PyInstaller build embeds graph.json and unpacks it to
    sys._MEIPASS, so the bundle's entry point must look there -- while still
    letting a graph.json dropped next to the executable win, which is what
    lets a shipped .exe be re-pointed at an edited graph without a rebuild.
    """
    bundle_dir = _write_bundle(tmp_path / "bundle", _text_to_code_to_output_graph())

    spec = importlib.util.spec_from_file_location("bundle_main", bundle_dir / "main.py")
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(bundle_dir))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(bundle_dir))

    # Not frozen: plain relative path, resolved against the working directory.
    assert module._default_graph_path() == Path("graph.json")

    meipass = tmp_path / "meipass"
    meipass.mkdir()
    exe_dir = tmp_path / "exe"
    exe_dir.mkdir()
    monkeypatch.setattr(sys, "_MEIPASS", str(meipass), raising=False)
    monkeypatch.setattr(sys, "executable", str(exe_dir / "tool"))

    assert module._default_graph_path() == meipass / "graph.json"

    (exe_dir / "graph.json").write_text("{}", encoding="utf-8")
    assert module._default_graph_path() == exe_dir / "graph.json"



# ---------------------------------------------------------------------------
# The web runtime: a GUI graph must deploy as a GUI, not as console prompts
# ---------------------------------------------------------------------------

def _fake_built_frontend(tmp_path: Path, monkeypatch) -> Path:
    """Stand in for `npm run build`'s output so these tests don't need node."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "runtime.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (dist / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (dist / "assets" / "runtime.js").write_text("console.log(1)", encoding="utf-8")
    # A binary asset, to pin down that the bundle carries bytes intact.
    (dist / "assets" / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n binary")
    monkeypatch.setattr(deploy_service, "_FRONTEND_DIST", dist)
    return dist


def test_gui_graph_bundles_the_web_runtime(tmp_path, monkeypatch):
    """A graph whose interface is a GUI node ships serve.py and the built page.
    Deploying it as a CLI would silently turn a file picker into a prompt for a
    typed path -- something other than what was designed."""
    _fake_built_frontend(tmp_path, monkeypatch)
    graph = _gui_workflow_graph(tmp_path / "sample.txt")

    bundle = generate_deployment_bundle(graph)

    repo_root = Path(__file__).parent.parent.parent
    assert bundle["serve.py"] == (repo_root / "graph-runner" / "serve.py").read_text(encoding="utf-8")
    assert bundle["static/runtime.html"] == b"<!doctype html><div id=root></div>"
    assert bundle["static/assets/logo.png"] == b"\x89PNG\r\n\x1a\n binary"
    # The CLI entry point is still there: the same bundle runs headless.
    assert "main.py" in bundle

    requirements = bundle["requirements.txt"]
    assert "fastapi" in requirements and "uvicorn" in requirements
    assert "serve.py" in bundle["Dockerfile"]
    assert "8000:8000" in bundle["docker-compose.yml"]


def test_headless_graph_stays_a_two_dependency_bundle(tmp_path, monkeypatch):
    """No GUI node -> no web server, no static files, no extra dependencies."""
    _fake_built_frontend(tmp_path, monkeypatch)
    bundle = generate_deployment_bundle(_text_to_code_to_output_graph())

    assert "serve.py" not in bundle
    assert not any(path.startswith("static/") for path in bundle)
    assert "fastapi" not in bundle["requirements.txt"]
    assert "uvicorn" not in bundle["requirements.txt"]


def test_gui_graph_without_a_built_frontend_still_deploys_headless(tmp_path, monkeypatch):
    """`npm run build` has never run: rather than failing the deploy, fall back
    to the CLI bundle -- the README is what tells the user why."""
    monkeypatch.setattr(deploy_service, "_FRONTEND_DIST", tmp_path / "does-not-exist")
    bundle = generate_deployment_bundle(_gui_workflow_graph(tmp_path / "sample.txt"))

    assert "serve.py" not in bundle
    assert "main.py" in bundle
    assert "fastapi" not in bundle["requirements.txt"]
