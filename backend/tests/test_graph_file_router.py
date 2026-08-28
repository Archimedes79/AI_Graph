"""
API tests for POST /api/graphs/file/load and /api/graphs/file/save -- the
editor's path-based New/Load/Save/Save As, which must round-trip to the exact
same file a graph was loaded from.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.main import app  # noqa: E402

client = TestClient(app)

MINIMAL_GRAPH = {
    "metadata": {"name": "Roundtrip"},
    "nodes": [],
    "edges": [],
}


def test_save_then_load_graph_file_roundtrips_to_the_same_path(tmp_path):
    target = tmp_path / "my_graph.json"

    save_response = client.post("/api/graphs/file/save", json={"path": str(target), "graph": MINIMAL_GRAPH})
    assert save_response.status_code == 200
    assert save_response.json()["path"] == str(target)
    assert target.exists()

    load_response = client.post("/api/graphs/file/load", json={"path": str(target)})
    assert load_response.status_code == 200
    body = load_response.json()
    assert body["path"] == str(target)
    assert body["graph"]["metadata"]["name"] == "Roundtrip"


def test_save_graph_file_resolves_relative_and_user_paths(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    response = client.post("/api/graphs/file/save", json={"path": "graph.json", "graph": MINIMAL_GRAPH})

    assert response.status_code == 200
    resolved = Path(response.json()["path"])
    assert resolved.is_absolute()
    assert resolved.exists()


def test_load_graph_file_missing_path_returns_404(tmp_path):
    missing = tmp_path / "does_not_exist.json"

    response = client.post("/api/graphs/file/load", json={"path": str(missing)})

    assert response.status_code == 404


def test_load_graph_file_invalid_json_returns_400(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("not valid json", encoding="utf-8")

    response = client.post("/api/graphs/file/load", json={"path": str(bad)})

    assert response.status_code == 400


def test_save_graph_file_updates_updated_at(tmp_path):
    target = tmp_path / "stamped.json"
    graph = {**MINIMAL_GRAPH, "metadata": {"name": "Stamped", "updated_at": ""}}

    response = client.post("/api/graphs/file/save", json={"path": str(target), "graph": graph})

    assert response.status_code == 200
    saved = json.loads(target.read_text(encoding="utf-8"))
    assert saved["metadata"]["updated_at"] != ""


# --- code in files beside the graph -----------------------------------------

def _graph_with_code_file(label="Analyse", code="def run(inputs):\n    return {'n': 1}"):
    return {
        "metadata": {"name": "Projekt"},
        "nodes": [{
            "id": "code-1", "node_type": "code", "label": label,
            "position": {"x": 0, "y": 0},
            "inputs": [], "outputs": [{"id": "n", "name": "N", "kind": "output",
                                       "data_type": "any", "multi": False, "required": False}],
            "config": {"language": "python", "code": code, "code_file": "placeholder.py",
                       "code_prompt": "Zähle etwas"},
        }],
        "edges": [],
    }


def test_saving_writes_the_node_file_next_to_the_graph(tmp_path):
    target = tmp_path / "projekt.json"
    response = client.post("/api/graphs/file/save", json={"path": str(target), "graph": _graph_with_code_file()})
    assert response.status_code == 200

    node_file = tmp_path / "projekt.nodes" / "Analyse.py"
    assert node_file.is_file(), "the node's code should live beside the graph"
    text = node_file.read_text(encoding="utf-8")
    assert "# node:    Analyse" in text
    assert "Zähle etwas" in text
    assert "return {'n': 1}" in text


def test_the_json_does_not_repeat_the_code(tmp_path):
    """Two copies of the same text is how they start disagreeing."""
    target = tmp_path / "projekt.json"
    client.post("/api/graphs/file/save", json={"path": str(target), "graph": _graph_with_code_file()})

    stored = json.loads(target.read_text(encoding="utf-8"))
    assert stored["nodes"][0]["config"]["code"] == ""
    assert stored["nodes"][0]["config"]["code_file"] == "Analyse.py"


def test_loading_fills_the_code_back_in_from_the_file(tmp_path):
    target = tmp_path / "projekt.json"
    client.post("/api/graphs/file/save", json={"path": str(target), "graph": _graph_with_code_file()})

    # Edit the file the way an external editor would.
    node_file = tmp_path / "projekt.nodes" / "Analyse.py"
    node_file.write_text(
        node_file.read_text(encoding="utf-8").replace("return {'n': 1}", "return {'n': 42}"),
        encoding="utf-8",
    )

    loaded = client.post("/api/graphs/file/load", json={"path": str(target)}).json()["graph"]
    assert "return {'n': 42}" in loaded["nodes"][0]["config"]["code"]


def test_renaming_the_node_renames_its_file(tmp_path):
    target = tmp_path / "projekt.json"
    client.post("/api/graphs/file/save", json={"path": str(target), "graph": _graph_with_code_file()})
    assert (tmp_path / "projekt.nodes" / "Analyse.py").is_file()

    renamed = _graph_with_code_file(label="Auswertung")
    renamed["nodes"][0]["config"]["code_file"] = "Analyse.py"
    saved = client.post("/api/graphs/file/save", json={"path": str(target), "graph": renamed}).json()

    assert (tmp_path / "projekt.nodes" / "Auswertung.py").is_file()
    assert not (tmp_path / "projekt.nodes" / "Analyse.py").exists()
    assert saved["graph"]["nodes"][0]["config"]["code_file"] == "Auswertung.py"


def test_a_missing_node_file_does_not_blank_the_node(tmp_path):
    """A graph copied without its sibling folder must still open."""
    target = tmp_path / "projekt.json"
    graph = _graph_with_code_file()
    graph["nodes"][0]["config"]["code_file"] = "Nicht_da.py"
    target.write_text(json.dumps(graph), encoding="utf-8")

    loaded = client.post("/api/graphs/file/load", json={"path": str(target)}).json()["graph"]
    assert "return {'n': 1}" in loaded["nodes"][0]["config"]["code"]


def test_a_node_without_a_file_keeps_its_code_in_the_graph(tmp_path):
    """Opting out stays possible: no code_file, no folder, unchanged behaviour."""
    target = tmp_path / "projekt.json"
    graph = _graph_with_code_file()
    graph["nodes"][0]["config"]["code_file"] = ""
    client.post("/api/graphs/file/save", json={"path": str(target), "graph": graph})

    stored = json.loads(target.read_text(encoding="utf-8"))
    assert "return {'n': 1}" in stored["nodes"][0]["config"]["code"]
    assert not (tmp_path / "projekt.nodes").exists()
