"""
ai_service.complete() provider dispatch, incl. the github_copilot provider.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services import ai_service  # noqa: E402


async def test_complete_dispatches_to_github_copilot(monkeypatch):
    calls = []

    async def fake_github_copilot_complete(prompt, system, model, temperature, timeout=120.0):
        calls.append({"prompt": prompt, "system": system, "model": model, "temperature": temperature})
        return "hello from copilot"

    monkeypatch.setattr(ai_service, "_github_copilot_complete", fake_github_copilot_complete)

    result = await ai_service.complete(
        prompt="hi", system="sys", model="openai/gpt-4o-mini", temperature=0.3, provider="github_copilot",
    )

    assert result == "hello from copilot"
    assert calls == [{"prompt": "hi", "system": "sys", "model": "openai/gpt-4o-mini", "temperature": 0.3}]


async def test_github_copilot_complete_requires_token(monkeypatch):
    monkeypatch.setattr(ai_service, "GITHUB_TOKEN", "")

    with pytest.raises(ValueError, match="GITHUB_TOKEN"):
        await ai_service._github_copilot_complete("hi", "", "openai/gpt-4o-mini", 0.3)


async def test_github_copilot_complete_calls_expected_endpoint(monkeypatch):
    monkeypatch.setattr(ai_service, "GITHUB_TOKEN", "fake-token")
    monkeypatch.setattr(ai_service, "GITHUB_MODELS_BASE_URL", "https://models.github.ai/inference")

    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": "42"}}]}

    class FakeAsyncClient:
        def __init__(self, timeout=120.0):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr(ai_service.httpx, "AsyncClient", FakeAsyncClient)

    result = await ai_service._github_copilot_complete("What is 6*7?", "sys", "openai/gpt-4o-mini", 0.2)

    assert result == "42"
    assert captured["url"] == "https://models.github.ai/inference/chat/completions"
    assert captured["headers"] == {"Authorization": "Bearer fake-token"}
    assert captured["json"]["model"] == "openai/gpt-4o-mini"
