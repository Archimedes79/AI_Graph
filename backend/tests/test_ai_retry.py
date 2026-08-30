"""
Transient AI failures are retried; configuration mistakes are not.
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services import ai_service  # noqa: E402


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    """Keep the backoff logic exercised but the suite fast."""
    monkeypatch.setattr(ai_service, "AI_RETRY_BASE_DELAY", 0.0)


def _status_error(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://example.test/v1/chat/completions")
    return httpx.HTTPStatusError("boom", request=request, response=httpx.Response(code, request=request))


async def test_a_rate_limit_is_retried_and_can_succeed(monkeypatch):
    attempts = 0

    async def flaky(prompt, system, model, temperature, timeout=None, images=None):
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise _status_error(429)
        return "finally"

    monkeypatch.setattr(ai_service, "_lmstudio_complete", flaky)

    result = await ai_service.complete("hi", provider="lmstudio", model="m")
    assert result == "finally"
    assert attempts == 3


async def test_a_connection_error_is_retried(monkeypatch):
    attempts = 0

    async def flaky(prompt, system, model, temperature, timeout=None, images=None):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.ConnectError("model still loading")
        return "up now"

    monkeypatch.setattr(ai_service, "_lmstudio_complete", flaky)

    assert await ai_service.complete("hi", provider="lmstudio", model="m") == "up now"
    assert attempts == 2


async def test_a_bad_request_is_not_retried(monkeypatch):
    """A 400 is a configuration mistake -- retrying only delays the message."""
    attempts = 0

    async def rejecting(prompt, system, model, temperature, timeout=None, images=None):
        nonlocal attempts
        attempts += 1
        raise _status_error(400)

    monkeypatch.setattr(ai_service, "_lmstudio_complete", rejecting)

    with pytest.raises(httpx.HTTPStatusError):
        await ai_service.complete("hi", provider="lmstudio", model="m")
    assert attempts == 1


async def test_a_missing_key_is_not_retried(monkeypatch):
    """Nor is anything that will fail identically every time."""
    attempts = 0

    async def unconfigured(prompt, system, model, temperature, timeout=None, images=None):
        nonlocal attempts
        attempts += 1
        raise ValueError("No OpenAI API key configured")

    monkeypatch.setattr(ai_service, "_openai_complete", unconfigured)

    with pytest.raises(ValueError):
        await ai_service.complete("hi", provider="openai", model="gpt-4o")
    assert attempts == 1


async def test_it_gives_up_after_the_configured_attempts(monkeypatch):
    attempts = 0

    async def always_down(prompt, system, model, temperature, timeout=None, images=None):
        nonlocal attempts
        attempts += 1
        raise _status_error(503)

    monkeypatch.setattr(ai_service, "_lmstudio_complete", always_down)
    monkeypatch.setattr(ai_service, "AI_MAX_ATTEMPTS", 3)

    with pytest.raises(httpx.HTTPStatusError):
        await ai_service.complete("hi", provider="lmstudio", model="m")
    assert attempts == 3


# ---------------------------------------------------------------------------
# An empty answer is a failure, not a success
# ---------------------------------------------------------------------------
#
# Every provider path ends in `_StreamProgress.text()`, which is "" when the
# stream carried no chunk -- a 200 with nothing in it. That raised nothing, so
# the node reported SUCCESS and passed an empty string on. LM Studio serving a
# model that is still loading does exactly this.


async def test_an_empty_answer_is_retried_and_can_succeed(monkeypatch):
    attempts = 0

    async def slow_to_wake(prompt, system, model, temperature, timeout=None, images=None):
        nonlocal attempts
        attempts += 1
        return "" if attempts == 1 else "awake"

    monkeypatch.setattr(ai_service, "_lmstudio_complete", slow_to_wake)

    assert await ai_service.complete("hi", provider="lmstudio", model="m") == "awake"
    assert attempts == 2


async def test_a_whitespace_only_answer_counts_as_empty(monkeypatch):
    """Blank is blank: a model that emits only a newline delivered nothing."""
    attempts = 0

    async def blank(prompt, system, model, temperature, timeout=None, images=None):
        nonlocal attempts
        attempts += 1
        return "\n  \n"

    monkeypatch.setattr(ai_service, "_lmstudio_complete", blank)
    monkeypatch.setattr(ai_service, "AI_MAX_ATTEMPTS", 2)

    with pytest.raises(ai_service.EmptyCompletionError):
        await ai_service.complete("hi", provider="lmstudio", model="m")
    assert attempts == 2


async def test_the_empty_answer_error_names_provider_and_model(monkeypatch):
    """The message is the whole value here: it has to say what did not answer."""

    async def blank(prompt, system, model, temperature, timeout=None, images=None):
        return ""

    monkeypatch.setattr(ai_service, "_lmstudio_complete", blank)
    monkeypatch.setattr(ai_service, "AI_MAX_ATTEMPTS", 1)

    with pytest.raises(ai_service.EmptyCompletionError) as caught:
        await ai_service.complete("hi", provider="lmstudio", model="qwen3-8b")
    assert "lmstudio" in str(caught.value)
    assert "qwen3-8b" in str(caught.value)
