"""
The editor's Settings dialog can supply an API key and an endpoint.

Before this existed the dialog offered hosted providers it had no way to make
work: the credential could only come from an environment variable or a
hand-written ai-settings.json the dialog never mentioned.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.main import app  # noqa: E402
from app.services import ai_settings  # noqa: E402

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path, monkeypatch):
    """Never touch the developer's real ai-settings.json."""
    target = tmp_path / "ai-settings.json"
    monkeypatch.setenv("AI_GRAPH_SETTINGS", str(target))
    ai_settings.reset_cache()
    yield target
    ai_settings.reset_cache()


def test_status_reports_no_key_before_one_is_set():
    body = client.get("/api/ai/settings").json()
    assert body["credentials"]["anthropic"]["configured"] is False
    assert body["credentials"]["anthropic"]["source"] == ""


def test_saving_a_key_makes_it_configured_without_returning_it(isolated_settings):
    response = client.post("/api/ai/settings", json={"api_keys": {"anthropic": "sk-ant-secret"}})
    assert response.status_code == 200

    body = response.json()
    assert body["credentials"]["anthropic"] == {"configured": True, "source": "settings file"}
    # The key itself must never travel back to the browser.
    assert "sk-ant-secret" not in json.dumps(body)
    # ...but it must actually be on disk for the AI service to find.
    assert json.loads(isolated_settings.read_text(encoding="utf-8"))["api_keys"]["anthropic"] == "sk-ant-secret"


def test_an_environment_key_counts_as_configured(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-from-env")
    body = client.get("/api/ai/settings").json()
    assert body["credentials"]["openai"] == {"configured": True, "source": "environment"}


def test_saving_one_key_does_not_wipe_another(isolated_settings):
    client.post("/api/ai/settings", json={"api_keys": {"anthropic": "sk-a"}})
    client.post("/api/ai/settings", json={"api_keys": {"openai": "sk-o"}})

    stored = json.loads(isolated_settings.read_text(encoding="utf-8"))["api_keys"]
    assert stored["anthropic"] == "sk-a"
    assert stored["openai"] == "sk-o"


def test_a_blank_key_means_unchanged_not_cleared(isolated_settings):
    """The dialog cannot read a key back, so submitting it blank must not wipe it."""
    client.post("/api/ai/settings", json={"api_keys": {"anthropic": "sk-keep"}})
    client.post("/api/ai/settings", json={"api_keys": {"anthropic": ""}})

    stored = json.loads(isolated_settings.read_text(encoding="utf-8"))["api_keys"]
    assert stored["anthropic"] == "sk-keep"


def test_clearing_a_key_is_explicit(isolated_settings):
    client.post("/api/ai/settings", json={"api_keys": {"anthropic": "sk-gone"}})
    body = client.post("/api/ai/settings", json={"clear_keys": ["anthropic"]}).json()

    assert body["credentials"]["anthropic"]["configured"] is False
    assert "anthropic" not in json.loads(isolated_settings.read_text(encoding="utf-8"))["api_keys"]


def test_endpoints_round_trip(isolated_settings):
    body = client.post("/api/ai/settings", json={"endpoints": {"lmstudio": "http://localhost:9999/v1"}}).json()
    assert body["endpoints"]["lmstudio"] == "http://localhost:9999/v1"

    stored = json.loads(isolated_settings.read_text(encoding="utf-8"))["endpoints"]
    assert stored["lmstudio_base_url"] == "http://localhost:9999/v1"
