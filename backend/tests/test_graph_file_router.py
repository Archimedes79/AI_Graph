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
