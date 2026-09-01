"""
API tests for the one generation endpoint, POST /api/ai/generate.

There were four routes -- generate-code, generate-prompt, generate-output-format,
generate-data-format -- with the same request shape, the same target resolution,
the same context-file handling and the same error wrapping, differing only in
which ai_service function they called and what they named the single string they
returned. What actually varies is declared on the element (`Generation`), so what
is under test here is that the server reads that declaration: the element's own
contract sentence reaches the model, a snippet with fixed ports gets those ports
rather than the node's, and an element that authors nothing is refused.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.elements.registry import generation_for  # noqa: E402
from app.main import app  # noqa: E402
from app.services import ai_service, code_refine  # noqa: E402

client = TestClient(app)

CODE = "def run(inputs):\n    return {'output': ''}\n"


@pytest.fixture
def captured_code(monkeypatch):
    """Capture what the code generator was asked for, without calling a model."""
    seen = {}

    async def fake(**kwargs):
        seen.update(kwargs)
        return CODE, "ok"

    monkeypatch.setattr(ai_service, "generate_code", fake)
    return seen


def test_a_code_node_is_generated_against_its_own_ports(captured_code):
    response = client.post("/api/ai/generate", json={
        "element": "code",
        "description": "count the words",
        "context": "from the editor",
        "inputs": ["text"], "outputs": ["count"],
    })
    assert response.status_code == 200
    body = response.json()
    assert body["result"] == CODE
    assert captured_code["inputs"] == ["text"]
    assert captured_code["outputs"] == ["count"]
    assert "from the editor" in captured_code["context"]


def test_a_widget_snippet_gets_the_ports_its_element_declares(captured_code):
    """A transform is wired as {"value"} -> {"value"} whatever the node's ports are."""
    response = client.post("/api/ai/generate", json={
        "element": "plot_window",
        "description": "bars per country",
        # Deliberately wrong: the editor does not know the snippet's ports, and
        # the element's declaration must win over anything sent.
        "inputs": ["w1_in"], "outputs": ["w1_out"],
    })
    assert response.status_code == 200
    assert captured_code["inputs"] == ["value"]
    assert captured_code["outputs"] == ["value"]


def test_the_elements_own_contract_reaches_the_model(captured_code):
    """The sentence lives in the element file and is added server-side.

    It describes what `execute()` will do with the snippet, so the editor never
    sends it -- a prompt that exists twice is a prompt that drifts, which is
    exactly what happened to the file-selector sentence.
    """
    client.post("/api/ai/generate", json={"element": "plot_window", "description": "x"})
    assert "do NOT draw anything" in captured_code["context"]

    client.post("/api/ai/generate", json={"element": "input_picker", "description": "x"})
    assert 'inputs["files"]' in captured_code["context"]

    client.post("/api/ai/generate", json={"element": "image_view", "description": "x"})
    assert "image file path" in captured_code["context"]


def test_the_example_file_is_read_server_side(tmp_path, captured_code):
    example = tmp_path / "sample.csv"
    example.write_text("country,people\nDE,84\n", encoding="utf-8")
    response = client.post("/api/ai/generate", json={
        "element": "code",
        "description": "sum the people column",
        "context_file": str(example),
    })
    assert response.status_code == 200
    assert "country,people" in captured_code["context"]
    # A parsed preview too, so the model sees the shape rather than inferring it.
    assert "Parsed preview" in captured_code["context"]


def test_a_missing_example_file_is_a_400_not_a_500():
    response = client.post("/api/ai/generate", json={
        "element": "code", "description": "x", "context_file": "/nope/missing.csv",
    })
    assert response.status_code == 400


def test_a_fixed_port_snippet_is_not_probed_against_the_nodes_sample(monkeypatch):
    """The sample is keyed by the node's ports; a transform has its own.

    Handing `{"w1_in": ...}` to a function that takes `{"value": ...}` would
    fail every probe and "repair" perfectly good code, so a fixed-port snippet
    gets the ordinary single pass.
    """
    seen = {}

    async def fake_verified(**kwargs):
        seen.update(kwargs)
        return CODE, "ok", code_refine.ProbeReport()

    monkeypatch.setattr(code_refine, "generate_verified_code", fake_verified)

    client.post("/api/ai/generate", json={
        "element": "plot_window", "description": "x",
        "sample_inputs": {"w1_in": [1, 2, 3]},
    })
    assert seen["sample_inputs"] is None

    client.post("/api/ai/generate", json={
        "element": "code", "description": "x", "inputs": ["text"], "outputs": ["out"],
        "sample_inputs": {"text": "hello"},
    })
    assert seen["sample_inputs"] == {"text": "hello"}


def test_a_prompt_element_returns_the_same_shape(monkeypatch):
    """One response shape for every generator: the caller knows its own field."""
    async def fake(**kwargs):
        return "You are helpful.", "why"

    monkeypatch.setattr(ai_service, "generate_prompt", fake)
    body = client.post("/api/ai/generate", json={
        "element": "ai", "description": "a helpful assistant",
    }).json()
    assert body["result"] == "You are helpful."
    assert body["explanation"] == "why"
    assert body["probe"]["status"] == "skipped"


def test_a_data_node_asks_the_data_format_generator(monkeypatch):
    """Four generator kinds, one route: the element says which one it wants."""
    seen = {}

    async def fake(**kwargs):
        seen.update(kwargs)
        return "A JSON array of line items.", ""

    monkeypatch.setattr(ai_service, "generate_data_format", fake)
    body = client.post("/api/ai/generate", json={
        "element": "data",
        "description": "invoice line items",
        "context": "Standard format family: structure.",
    }).json()
    assert body["result"] == "A JSON array of line items."
    assert "structure" in seen["context"]


def test_the_output_format_belongs_to_no_element(monkeypatch):
    """An ai node and a code node ask this identical question, so it goes by kind."""
    async def fake(**kwargs):
        return "A JSON array of {name, count}.", ""

    monkeypatch.setattr(ai_service, "generate_output_format", fake)
    body = client.post("/api/ai/generate", json={
        "kind": "output_format", "description": "counts per name",
    }).json()
    assert body["result"] == "A JSON array of {name, count}."


def test_an_element_that_authors_nothing_is_refused():
    for element in ("output", "gui", "text_io"):
        assert generation_for(element) is None
        response = client.post("/api/ai/generate", json={"element": element, "description": "x"})
        assert response.status_code == 400, element
    assert client.post("/api/ai/generate", json={
        "element": "not-an-element", "description": "x"}).status_code == 400
    assert client.post("/api/ai/generate", json={
        "kind": "not-a-kind", "description": "x"}).status_code == 400


def test_a_failing_generator_is_a_500_with_the_providers_own_message(monkeypatch):
    async def boom(**kwargs):
        raise RuntimeError("LM Studio is not running")

    monkeypatch.setattr(ai_service, "generate_code", boom)
    response = client.post("/api/ai/generate", json={"element": "code", "description": "x"})
    assert response.status_code == 500
    assert "LM Studio is not running" in response.text


# --- the transcript ----------------------------------------------------------
#
# Generation is a black box from outside: press the button, wait, get text or an
# error. When the error is "the context window may be overloaded" there is no
# way to check it, because nobody can see what was sent -- and code generation
# is not one call, it generates, runs the result and repairs it.

@pytest.mark.asyncio
async def test_the_response_carries_every_model_call_that_was_made(monkeypatch):
    """Two passes, both in the record, in order."""
    sent = []

    async def fake_complete(prompt, system="", model="", temperature=0.7, provider="", images=None):
        # Go through the real recorder rather than around it: what is under
        # test is that `complete` records, not that a fake can append.
        entry = ai_service._record(provider or "stub", model or "stub-model", system, prompt)
        sent.append(prompt)
        reply = f"reply {len(sent)}"
        if entry is not None:
            entry["reply"] = reply
            entry["reply_chars"] = len(reply)
        return reply

    async def two_passes(**kwargs):
        await fake_complete("first pass", system="be brief")
        await fake_complete("second pass, repairing")
        return CODE, "explained", code_refine.ProbeReport()

    monkeypatch.setattr(ai_service, "complete", fake_complete)
    monkeypatch.setattr(code_refine, "generate_verified_code", two_passes)

    response = client.post("/api/ai/generate", json={
        "element": "code", "description": "count the rows", "language": "javascript",
    })
    assert response.status_code == 200, response.text

    calls = response.json()["calls"]
    assert [call["prompt"] for call in calls] == ["first pass", "second pass, repairing"]
    assert calls[0]["system"] == "be brief"
    # Counted on the server, so "how much did I send" has one answer.
    assert calls[0]["sent_chars"] == len("first pass") + len("be brief")
    assert calls[0]["reply"] == "reply 1"


@pytest.mark.asyncio
async def test_a_generation_nobody_is_watching_records_nothing(monkeypatch):
    """The recorder is opt-in, so a run outside the route costs nothing."""
    captured = []

    async def fake_complete(prompt, system="", model="", temperature=0.7, provider="", images=None):
        captured.append(ai_service._record(provider, model, system, prompt))
        return "text"

    monkeypatch.setattr(ai_service, "complete", fake_complete)
    await ai_service.complete("outside any request")
    assert captured == [None]


@pytest.mark.asyncio
async def test_a_failed_generation_still_reports_what_it_sent(monkeypatch):
    """The transcript matters most when there is no answer to show."""

    async def fails(**kwargs):
        entry = ai_service._record("stub", "stub-model", "be brief", "the one prompt")
        if entry is not None:
            entry["error"] = "returned no content"
        raise RuntimeError("stub-model returned no content")

    monkeypatch.setattr(code_refine, "generate_verified_code", fails)

    response = client.post("/api/ai/generate", json={
        "element": "code", "description": "count the rows", "language": "javascript",
    })
    assert response.status_code == 500

    body = response.json()
    # The message keeps its usual place, so every existing reader still works.
    assert "returned no content" in body["detail"]
    assert [call["prompt"] for call in body["calls"]] == ["the one prompt"]
    assert body["calls"][0]["error"] == "returned no content"
