"""
API tests for POST /api/ai/generate-code, /generate-prompt, /generate-output-format:
the shared `context_file` field (read server-side and appended to `context`).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.main import app  # noqa: E402
from app.services import ai_service  # noqa: E402

client = TestClient(app)


def test_generate_code_merges_context_file_content(tmp_path, monkeypatch):
    context_file = tmp_path / "ctx.txt"
    context_file.write_text("rows have a 'category' column", encoding="utf-8")
    captured = {}

    async def fake_generate_code(**kwargs):
        captured.update(kwargs)
        return "def run(inputs):\n    return {}\n", "ok"

    monkeypatch.setattr(ai_service, "generate_code", fake_generate_code)

    response = client.post("/api/ai/generate-code", json={
        "description": "group rows by category",
        "context": "existing context",
        "context_file": str(context_file),
        "inputs": ["input"], "outputs": ["output"],
    })

    assert response.status_code == 200
    assert "existing context" in captured["context"]
    assert "rows have a 'category' column" in captured["context"]


def test_generate_prompt_merges_context_file_content(tmp_path, monkeypatch):
    context_file = tmp_path / "ctx.txt"
    context_file.write_text("be concise", encoding="utf-8")
    captured = {}

    async def fake_generate_prompt(**kwargs):
        captured.update(kwargs)
        return "You are helpful.", "ok"

    monkeypatch.setattr(ai_service, "generate_prompt", fake_generate_prompt)

    response = client.post("/api/ai/generate-prompt", json={
        "description": "a helpful assistant",
        "context_file": str(context_file),
    })

    assert response.status_code == 200
    assert "be concise" in captured["context"]


def test_generate_code_context_file_includes_parsed_csv_preview(tmp_path, monkeypatch):
    context_file = tmp_path / "sample.csv"
    context_file.write_text("x,y\n1,2\n3,4\n", encoding="utf-8")
    captured = {}

    async def fake_generate_code(**kwargs):
        captured.update(kwargs)
        return "def run(inputs):\n    return {}\n", "ok"

    monkeypatch.setattr(ai_service, "generate_code", fake_generate_code)

    response = client.post("/api/ai/generate-code", json={
        "description": "plot x vs y",
        "context_file": str(context_file),
    })

    assert response.status_code == 200
    assert "format=csv" in captured["context"]
    assert "Parsed preview" in captured["context"]
    assert '"x": "1"' in captured["context"]


def test_generate_code_missing_context_file_returns_400(tmp_path):
    missing = tmp_path / "does_not_exist.txt"

    response = client.post("/api/ai/generate-code", json={
        "description": "x", "context_file": str(missing),
    })

    assert response.status_code == 400


def test_generate_output_format_endpoint(monkeypatch):
    async def fake_generate_output_format(description, context, model, provider):
        assert "extra note" in context
        return "A JSON array of {title, score}", "ok"

    monkeypatch.setattr(ai_service, "generate_output_format", fake_generate_output_format)

    response = client.post("/api/ai/generate-output-format", json={
        "description": "score each item",
        "context": "extra note",
    })

    assert response.status_code == 200
    assert response.json()["output_format_prompt"] == "A JSON array of {title, score}"


@pytest.mark.asyncio
async def test_ai_service_generate_output_format_extracts_tagged_content(monkeypatch):
    async def fake_complete(prompt, system, model, temperature, provider):
        return "<output_format>A list of ints</output_format>\nExplanation here."

    monkeypatch.setattr(ai_service, "complete", fake_complete)

    fmt, explanation = await ai_service.generate_output_format("counts as a list")

    assert fmt == "A list of ints"
    assert "Explanation" in explanation
