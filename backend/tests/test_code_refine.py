"""
Two-pass code generation: generate, run it against real data, repair once.

These use scripted `generate_code` stand-ins and real sandboxed execution, so
what is under test is the loop's judgement -- when it probes, what evidence it
hands the second pass, and which of the two attempts the user ends up with.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services import ai_service, code_refine  # noqa: E402

GOOD = "function run(inputs) {\n  return { total: inputs.items.reduce((s, i) => s + Number(i.count), 0) };\n}\n"
WRONG_KEY = "function run(inputs) {\n  return { sum: inputs.items.reduce((s, i) => s + Number(i.count), 0) };\n}\n"
CRASHES = "function run(inputs) {\n  return { total: inputs.items.toUpperCase() };\n}\n"

SAMPLE = {"items": [{"count": 2}, {"count": 3}]}
OUTPUTS = ["total"]


def _scripted(monkeypatch, *codes: str):
    """Hand out `codes` one per generate_code call; record the contexts sent."""
    remaining = list(codes)
    contexts: list[str] = []

    # **_ rather than a copy of the real signature: this stub is here to script
    # what comes back, and pinning the caller's argument list made it fail
    # whenever generate_code learned a new optional argument -- a failure about
    # the test, not about the two-pass behaviour it covers.
    async def fake_generate_code(description, context="", inputs=None,
                                 outputs=None, model="", provider="default", **_):
        contexts.append(context)
        return remaining.pop(0), "explanation"

    monkeypatch.setattr(ai_service, "generate_code", fake_generate_code)
    return contexts


async def _generate(**overrides):
    kwargs = dict(
        description="sum the counts", context="base context",
        inputs=["items"], outputs=OUTPUTS, model="m", provider="default",
    )
    kwargs.update(overrides)
    return await code_refine.generate_verified_code(**kwargs)


async def test_without_a_sample_it_stays_a_single_pass(monkeypatch):
    """No last run to check against: generate once and say nothing more. This is
    also the opt-out for anyone who does not want model-written code executed
    before they have read it."""
    contexts = _scripted(monkeypatch, GOOD)

    code, _, report = await _generate(sample_inputs=None)

    assert code == GOOD
    assert report.status == "skipped"
    assert report.attempts == 0
    assert len(contexts) == 1


async def test_a_first_attempt_that_works_is_reported_as_verified(monkeypatch):
    contexts = _scripted(monkeypatch, GOOD)

    code, _, report = await _generate(sample_inputs=SAMPLE)

    assert code == GOOD
    assert report.status == "ok"
    assert report.attempts == 1
    assert "5" in report.output_preview
    assert len(contexts) == 1, "a working first attempt must not cost a second call"


async def test_a_wrong_result_key_is_repaired(monkeypatch):
    """The most common silent failure: the code runs, returns something, and the
    downstream node reads nothing because the key does not match the port."""
    contexts = _scripted(monkeypatch, WRONG_KEY, GOOD)

    code, _, report = await _generate(sample_inputs=SAMPLE)

    assert code == GOOD
    assert report.status == "repaired"
    assert report.attempts == 2

    repair_context = contexts[1]
    assert "'total'" in repair_context, "the second pass must be told which key is missing"
    assert "sum:" in repair_context, "and must see its own previous attempt"


async def test_a_crash_hands_the_traceback_to_the_second_pass(monkeypatch):
    contexts = _scripted(monkeypatch, CRASHES, GOOD)

    code, _, report = await _generate(sample_inputs=SAMPLE)

    assert code == GOOD
    assert report.status == "repaired"

    repair_context = contexts[1]
    assert "toUpperCase is not a function" in repair_context
    assert '"items"' in repair_context and "list[2]" in repair_context, (
        "the second pass must see the shape of the real input, not just the error"
    )


async def test_two_broken_attempts_still_return_code_and_say_why(monkeypatch):
    """A failed repair must never leave the user empty-handed -- they get the
    code plus an honest note, not an exception."""
    _scripted(monkeypatch, CRASHES, CRASHES)

    code, _, report = await _generate(sample_inputs=SAMPLE)

    assert code == CRASHES
    assert report.status == "failed"
    assert report.error


async def test_a_failing_repair_pass_falls_back_to_the_first_attempt(monkeypatch):
    """The repair round is a bonus; an unreachable model during it must not cost
    the user the code that was already generated."""
    calls = {"n": 0}

    async def flaky(description, context="", inputs=None,
                    outputs=None, model="", provider="default", **_):
        calls["n"] += 1
        if calls["n"] == 1:
            return WRONG_KEY, "explanation"
        raise RuntimeError("model unreachable")

    monkeypatch.setattr(ai_service, "generate_code", flaky)

    code, _, report = await _generate(sample_inputs=SAMPLE)

    assert code == WRONG_KEY
    assert report.status == "failed"
    assert report.missing_outputs == ["total"]
