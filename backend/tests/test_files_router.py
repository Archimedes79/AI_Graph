"""
API tests for the files router (detect-format, browse).
"""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.main import app  # noqa: E402

client = TestClient(app)


def test_detect_format_endpoint_happy_path(tmp_path):
    p = tmp_path / "notes.txt"
    p.write_text("hello world", encoding="utf-8")

    response = client.post("/api/files/detect-format", json={"path": str(p)})

    assert response.status_code == 200
    assert response.json() == {"format": "text"}


def test_detect_format_endpoint_missing_file_returns_404(tmp_path):
    missing = tmp_path / "does_not_exist.txt"

    response = client.post("/api/files/detect-format", json={"path": str(missing)})

    assert response.status_code == 404


def test_detect_format_endpoint_missing_path_field_returns_400():
    response = client.post("/api/files/detect-format", json={})

    assert response.status_code == 400


def test_upload_and_delete_attachment_roundtrip(monkeypatch, tmp_path):
    from app.services import file_service

    monkeypatch.setattr(file_service, "ATTACHMENTS_DIR", tmp_path)

    response = client.post(
        "/api/files/attachments",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "notes.txt"
    saved_path = Path(body["path"])
    assert saved_path.exists()
    assert saved_path.read_bytes() == b"hello world"

    delete_response = client.request("DELETE", "/api/files/attachments", params={"path": body["path"]})
    assert delete_response.status_code == 200
    assert not saved_path.exists()


def test_delete_attachment_outside_directory_rejected(monkeypatch, tmp_path):
    from app.services import file_service

    monkeypatch.setattr(file_service, "ATTACHMENTS_DIR", tmp_path / "attachments")
    outside = tmp_path / "outside.txt"
    outside.write_text("keep me", encoding="utf-8")

    response = client.request("DELETE", "/api/files/attachments", params={"path": str(outside)})

    assert response.status_code == 400
    assert outside.exists()


def test_browse_lists_directories_and_files(tmp_path):
    """The picker's listing: folders first, then files, both alphabetical."""
    (tmp_path / "sub").mkdir()
    (tmp_path / "b.txt").write_text("b", encoding="utf-8")
    (tmp_path / "a.md").write_text("a", encoding="utf-8")

    response = client.post("/api/files/browse", json={"path": str(tmp_path)})
    assert response.status_code == 200
    body = response.json()

    assert body["path"] == str(tmp_path.resolve())
    assert body["parent"] == str(tmp_path.resolve().parent)
    assert [e["name"] for e in body["entries"]] == ["sub", "a.md", "b.txt"]
    assert [e["is_dir"] for e in body["entries"]] == [True, False, False]
    assert body["roots"]


def test_browse_extension_filter_keeps_directories(tmp_path):
    """A filter hides non-matching FILES only -- hiding folders would make the
    directories the user is navigating through disappear."""
    (tmp_path / "sub").mkdir()
    (tmp_path / "keep.md").write_text("k", encoding="utf-8")
    (tmp_path / "drop.txt").write_text("d", encoding="utf-8")

    body = client.post("/api/files/browse", json={"path": str(tmp_path), "extensions": ".md"}).json()
    assert [e["name"] for e in body["entries"]] == ["sub", "keep.md"]


def test_browse_a_file_path_opens_its_folder(tmp_path):
    """Re-opening the picker on an already-chosen file should land next to it."""
    target = tmp_path / "chosen.txt"
    target.write_text("x", encoding="utf-8")

    body = client.post("/api/files/browse", json={"path": str(target)}).json()
    assert body["path"] == str(tmp_path.resolve())


def test_browse_missing_directory_is_404(tmp_path):
    response = client.post("/api/files/browse", json={"path": str(tmp_path / "nope")})
    assert response.status_code == 404
