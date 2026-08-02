from __future__ import annotations

import builtins
import importlib.util
from pathlib import Path

import pytest


def _load_runner_module():
    root = Path(__file__).resolve().parents[2]
    runner_path = root / "graph-runner" / "run.py"
    spec = importlib.util.spec_from_file_location("graph_runner_run", runner_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_runner_uses_default_values_when_stdin_is_unavailable(capsys, monkeypatch):
    runner = _load_runner_module()
    graph_path = Path(__file__).resolve().parents[2] / "examples" / "hello_world.json"

    def raise_eof(prompt: str) -> str:
        raise EOFError(prompt)

    monkeypatch.setattr(builtins, "input", raise_eof)

    await runner.run(str(graph_path), {})

    captured = capsys.readouterr()
    assert '"status": "success"' in captured.out
    assert '"Hello Result"' in captured.out
    assert '"Hello, World!"' in captured.out