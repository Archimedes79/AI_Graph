"""
API tests for POST /api/files/detect-format.
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
