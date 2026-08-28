"""
The interval trigger: `python main.py --every 5m`.

The whole scheduler, deliberately: a loop in the runner rather than a service,
so it works identically from the repo, from a deploy bundle and from a built
executable, with nothing to install.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import sys
from pathlib import Path

import pytest


async def _no_wait(_seconds):
    """Patched in for asyncio.sleep: the schedule is under test, not the clock.
    (Patching it with a lambda that calls asyncio.sleep recurses -- runner.asyncio
    is the very module being patched.)"""
    return None

sys.path.insert(0, str(Path(__file__).parent.parent))

_spec = importlib.util.spec_from_file_location(
    "graph_runner_cli", Path(__file__).parent.parent.parent / "graph-runner" / "run.py"
)
runner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(runner)


@pytest.mark.parametrize("text,expected", [
    ("45", 45.0),
    ("30s", 30.0),
    ("5m", 300.0),
    ("2h", 7200.0),
    ("1d", 86400.0),
    ("0.5m", 30.0),
])
def test_interval_shorthands(text, expected):
    assert runner.parse_interval(text) == expected


@pytest.mark.parametrize("text", ["", "soon", "-5", "0", "5x"])
def test_a_nonsense_interval_is_rejected_at_the_command_line(text):
    with pytest.raises(argparse.ArgumentTypeError):
        runner.parse_interval(text)


async def test_it_runs_the_graph_the_requested_number_of_times(monkeypatch):
    calls = []

    async def fake_run(graph_path, extra, exit_on_error=True):
        calls.append(graph_path)

    monkeypatch.setattr(runner, "run", fake_run)
    monkeypatch.setattr(runner.asyncio, "sleep", _no_wait)

    await runner.run_every("graph.json", {}, interval=60, limit=3)
    assert calls == ["graph.json"] * 3


async def test_a_failing_run_does_not_end_the_schedule(monkeypatch):
    """A scheduled tool that stops at the first bad night is not much of one."""
    attempts = 0

    async def flaky(graph_path, extra, exit_on_error=True):
        nonlocal attempts
        attempts += 1
        if attempts == 2:
            raise RuntimeError("that one went wrong")

    monkeypatch.setattr(runner, "run", flaky)
    monkeypatch.setattr(runner.asyncio, "sleep", _no_wait)

    await runner.run_every("graph.json", {}, interval=60, limit=4)
    assert attempts == 4


async def test_a_scheduled_run_does_not_exit_the_process_on_error(monkeypatch):
    """run() exits on error for a one-shot CLI; under --every it must not, or
    the first failure would kill the schedule."""
    seen = {}

    async def record(graph_path, extra, exit_on_error=True):
        seen["exit_on_error"] = exit_on_error

    monkeypatch.setattr(runner, "run", record)
    monkeypatch.setattr(runner.asyncio, "sleep", _no_wait)

    await runner.run_every("graph.json", {}, interval=1, limit=1)
    assert seen["exit_on_error"] is False
