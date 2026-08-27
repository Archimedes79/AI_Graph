"""
ai_service.complete() provider dispatch, and the runtime AI configuration that
decides which provider a node with no opinion of its own actually calls.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services import ai_service, ai_settings  # noqa: E402


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

    class FakeStreamResponse:
        def raise_for_status(self):
            pass

        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"42"}}]}'
            yield "data: [DONE]"

    class FakeStreamCtx:
        async def __aenter__(self):
            return FakeStreamResponse()

        async def __aexit__(self, *exc):
            return False

    class FakeAsyncClient:
        def __init__(self, timeout=120.0):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, method, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return FakeStreamCtx()

    monkeypatch.setattr(ai_service.httpx, "AsyncClient", FakeAsyncClient)

    result = await ai_service._github_copilot_complete("What is 6*7?", "sys", "openai/gpt-4o-mini", 0.2)

    assert result == "42"
    assert captured["url"] == "https://models.github.ai/inference/chat/completions"
    assert captured["headers"] == {"Authorization": "Bearer fake-token"}
    assert captured["json"]["model"] == "openai/gpt-4o-mini"


# ---------------------------------------------------------------------------
# Configure the AI once, not per node
# ---------------------------------------------------------------------------

@pytest.fixture
def clean_ai_settings(monkeypatch, tmp_path):
    """Isolate the resolver from the developer's own environment and any
    ai-settings.json lying around, then restore module state afterwards."""
    for var in (
        "AI_GRAPH_AI_PROVIDER", "AI_GRAPH_AI_MODEL", "AI_GRAPH_AI_FORCE",
        "AI_GRAPH_GEN_PROVIDER", "AI_GRAPH_GEN_MODEL",
    ):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("AI_GRAPH_SETTINGS", str(tmp_path / "ai-settings.json"))
    # No network in tests: whatever ollama/LM Studio the developer's machine
    # happens to run must not leak into the resolution being asserted.
    monkeypatch.setattr(ai_settings, "probe_local_models", lambda *a, **k: None)
    ai_settings.reset_cache()
    ai_settings.set_graph_defaults()
    ai_settings.set_override()
    yield
    ai_settings.reset_cache()
    ai_settings.set_graph_defaults()
    ai_settings.set_override()


def test_default_sentinel_falls_back_when_nothing_is_configured(clean_ai_settings):
    assert ai_settings.resolve_target("default", "") == ("ollama", "llama3")
    # A graph written before the sentinel existed has an empty provider.
    assert ai_settings.resolve_target("", "") == ("ollama", "llama3")


def test_unconfigured_machine_uses_the_local_provider_that_is_running(clean_ai_settings, monkeypatch):
    """Nothing configured anywhere, ollama down, LM Studio serving models:
    resolution must land on LM Studio and its first served model instead of
    a dead ollama/llama3 endpoint."""
    monkeypatch.setattr(
        ai_settings, "probe_local_models",
        lambda provider, *a, **k: ["gemma-local"] if provider == "lmstudio" else None,
    )
    assert ai_settings.resolve_target("default", "") == ("lmstudio", "gemma-local")


def test_pinned_local_provider_without_model_uses_its_first_served_model(clean_ai_settings, monkeypatch):
    monkeypatch.setattr(
        ai_settings, "probe_local_models",
        lambda provider, *a, **k: ["qwen-local"] if provider == "lmstudio" else None,
    )
    assert ai_settings.resolve_target("lmstudio", "") == ("lmstudio", "qwen-local")


def test_explicit_configuration_beats_local_discovery(clean_ai_settings, monkeypatch):
    monkeypatch.setattr(
        ai_settings, "probe_local_models",
        lambda provider, *a, **k: ["gemma-local"] if provider == "lmstudio" else None,
    )
    monkeypatch.setenv("AI_GRAPH_AI_PROVIDER", "anthropic")
    monkeypatch.setenv("AI_GRAPH_AI_MODEL", "claude-x")
    assert ai_settings.resolve_target("default", "") == ("anthropic", "claude-x")


def test_node_that_names_a_provider_keeps_it(clean_ai_settings):
    ai_settings.set_graph_defaults("lmstudio", "local-7b")
    assert ai_settings.resolve_target("anthropic", "claude-x") == ("anthropic", "claude-x")
    assert ai_settings.resolve_target("default", "") == ("lmstudio", "local-7b")


def test_precedence_graph_then_settings_file_then_env_then_cli(clean_ai_settings, monkeypatch, tmp_path):
    """Each layer overrides the one below it -- this is what lets one deployed
    graph run against a local model on one machine and a hosted one on another
    without the graph itself changing."""
    ai_settings.set_graph_defaults("ollama", "llama3")
    assert ai_settings.resolve_target("default", "") == ("ollama", "llama3")

    settings_file = tmp_path / "ai-settings.json"
    settings_file.write_text(
        json.dumps({"ai": {"provider": "lmstudio", "model": "local-7b"}}), encoding="utf-8"
    )
    ai_settings.reset_cache()
    assert ai_settings.resolve_target("default", "") == ("lmstudio", "local-7b")

    monkeypatch.setenv("AI_GRAPH_AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_GRAPH_AI_MODEL", "gpt-4o-mini")
    assert ai_settings.resolve_target("default", "") == ("openai", "gpt-4o-mini")

    ai_settings.set_override("anthropic", "claude-x")
    assert ai_settings.resolve_target("default", "") == ("anthropic", "claude-x")


def test_force_also_overrides_nodes_that_pin_a_provider(clean_ai_settings):
    ai_settings.set_override("lmstudio", "local-7b", force=True)
    assert ai_settings.resolve_target("anthropic", "claude-x") == ("lmstudio", "local-7b")


def test_code_generation_target_is_separate_from_the_runtime_one(clean_ai_settings, monkeypatch):
    """Generation benefits from a stronger model than the cheap/local one a
    graph runs its inference on, so the two resolve independently."""
    ai_settings.set_graph_defaults("ollama", "llama3")
    monkeypatch.setenv("AI_GRAPH_GEN_PROVIDER", "anthropic")
    monkeypatch.setenv("AI_GRAPH_GEN_MODEL", "claude-sonnet")

    assert ai_settings.resolve_gen_target("default", "") == ("anthropic", "claude-sonnet")
    assert ai_settings.resolve_target("default", "") == ("ollama", "llama3")
    # What the editor explicitly sends still wins over the server default.
    assert ai_settings.resolve_gen_target("openai", "gpt-4o") == ("openai", "gpt-4o")


def test_endpoints_and_keys_come_from_the_settings_file_when_no_env_var_is_set(
    clean_ai_settings, tmp_path,
):
    """A double-clicked executable has no environment variables to speak of, so
    the settings file has to be able to supply the endpoint and key too."""
    (tmp_path / "ai-settings.json").write_text(
        json.dumps({
            "endpoints": {"lmstudio_base_url": "http://192.168.1.9:1234/v1"},
            "api_keys": {"anthropic": "sk-from-file"},
        }),
        encoding="utf-8",
    )
    ai_settings.reset_cache()

    assert ai_service._lmstudio_base_url() == "http://192.168.1.9:1234/v1"
    assert ai_service._anthropic_api_key() == "sk-from-file"


async def test_complete_resolves_the_default_sentinel_before_dispatching(clean_ai_settings, monkeypatch):
    """The resolution happens in exactly one place: an element never has to
    know where the runtime AI configuration comes from."""
    seen = {}

    async def fake_lmstudio(prompt, system, model, temperature, timeout=120.0):
        seen["model"] = model
        return "ok"

    monkeypatch.setattr(ai_service, "_lmstudio_complete", fake_lmstudio)
    ai_settings.set_graph_defaults("lmstudio", "local-7b")

    assert await ai_service.complete(prompt="hi", provider="default", model="") == "ok"
    assert seen["model"] == "local-7b"
