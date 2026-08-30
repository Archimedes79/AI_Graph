"""
Google Gemini through its OpenAI-compatible endpoint.

Worth its own test only because the point of the `_OPENAI_STYLE` table is that a
provider like this costs one entry: if adding Gemini had needed a request
builder of its own, the table would not be doing its job.
"""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import AIProvider  # noqa: E402
from app.services import ai_service  # noqa: E402


def test_google_is_a_provider():
    assert AIProvider.GOOGLE.value == "google"


def test_google_is_served_by_the_shared_openai_request_builder():
    """One table entry, not a second implementation."""
    assert "google" in ai_service._OPENAI_STYLE
    spec = ai_service._OPENAI_STYLE["google"]
    assert spec.credential_required is True
    assert "generativelanguage.googleapis.com" in spec.base_url()


async def test_complete_dispatches_to_google(monkeypatch):
    seen = {}

    async def fake(prompt, system, model, temperature, timeout=None, images=None):
        seen["model"] = model
        return "hallo"

    monkeypatch.setattr(ai_service, "_google_complete", fake)
    result = await ai_service.complete("hi", provider="google", model="gemini-2.0-flash")

    assert result == "hallo"
    assert seen["model"] == "gemini-2.0-flash"


async def test_a_missing_key_says_where_to_get_a_free_one(monkeypatch):
    """The error is the only place a newcomer will look.

    Patch the credential on the `_OPENAI_STYLE` entry, not the module
    attribute: the table captured the function object at import time, so
    rebinding `ai_service._google_api_key` leaves the spec pointing at the
    original -- which used to let this test fall through to a real HTTP call
    against Google on every run.
    """
    spec = ai_service._OPENAI_STYLE["google"]
    monkeypatch.setitem(
        ai_service._OPENAI_STYLE, "google", replace(spec, credential=lambda: ""),
    )

    with pytest.raises(ValueError) as excinfo:
        await ai_service._google_complete("hi", "", "gemini-flash-lite-latest", 0.7)

    assert "aistudio.google.com" in str(excinfo.value)


async def test_vision_works_for_google_because_the_format_is_shared():
    """Gemini sees images through the same content-parts shape as OpenAI."""
    content = ai_service._openai_user_content("was ist das?", ["data:image/png;base64,AAA"])
    assert content[1]["type"] == "image_url"
