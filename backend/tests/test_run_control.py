"""
Watchable, stoppable runs.

A graph run used to be one blocking request: nothing said which node was busy,
and the only way out of a long one was to abandon the request -- which left the
work running unwatched.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import ExecutionStatus, Graph  # noqa: E402
from app.services import graph_executor, run_registry  # noqa: E402

_real_execute_node = graph_executor._execute_node


@pytest.fixture(autouse=True)
def clean_registry():
    run_registry.reset()
    yield
    run_registry.reset()


def _chain(node_count: int) -> Graph:
    """A straight line of code nodes, so execution has distinct steps to report."""
    nodes = []
    edges = []
    for i in range(node_count):
        nodes.append({
            "id": f"n{i}", "node_type": "code", "label": f"Step {i}",
            "position": {"x": i * 150, "y": 0},
            "inputs": ([{"id": "value", "name": "In", "kind": "input",
                         "data_type": "any", "multi": False, "required": False}] if i else []),
            "outputs": [{"id": "result", "name": "Out", "kind": "output",
                         "data_type": "any", "multi": False, "required": False}],
            "config": {"code": "def run(inputs):\n    return {'result': 1}", "language": "python"},
        })
        if i:
            edges.append({"id": f"e{i}", "source_node_id": f"n{i-1}", "source_port_id": "result",
                          "target_node_id": f"n{i}", "target_port_id": "value"})
    return Graph.model_validate({"metadata": {"name": "chain"}, "nodes": nodes, "edges": edges})


async def test_a_run_reports_progress_and_then_its_result(monkeypatch):
    async def quick(node, inputs, effective_formats=None):
        await asyncio.sleep(0.02)
        return {"result": 1}

    monkeypatch.setattr(graph_executor, "_execute_node", quick)

    run = run_registry.start(_chain(4))
    assert run.total == 4

    await run.task
    snapshot = run.snapshot()

    assert snapshot["done"] is True
    assert snapshot["completed"] == 4
    assert snapshot["result"]["status"] == ExecutionStatus.SUCCESS.value
    assert snapshot["running"] == []


async def test_a_run_names_the_node_it_is_working_on(monkeypatch):
    started = asyncio.Event()
    release = asyncio.Event()

    async def blocking(node, inputs, effective_formats=None):
        started.set()
        await release.wait()
        return {"result": 1}

    monkeypatch.setattr(graph_executor, "_execute_node", blocking)

    run = run_registry.start(_chain(3))
    await asyncio.wait_for(started.wait(), timeout=2)

    snapshot = run.snapshot()
    assert snapshot["done"] is False
    assert snapshot["current_label"] == "Step 0"
    assert snapshot["running"] == ["n0"]

    release.set()
    await run.task


async def test_cancelling_stops_the_work_rather_than_abandoning_it(monkeypatch):
    """The point of Stop: the node in flight is actually interrupted."""
    started = asyncio.Event()
    finished_all = False

    async def slow(node, inputs, effective_formats=None):
        nonlocal finished_all
        started.set()
        await asyncio.sleep(5)
        finished_all = True
        return {"result": 1}

    monkeypatch.setattr(graph_executor, "_execute_node", slow)

    run = run_registry.start(_chain(3))
    await asyncio.wait_for(started.wait(), timeout=2)

    assert run_registry.cancel(run.id) is True
    with pytest.raises(asyncio.CancelledError):
        await run.task

    assert run.cancelled is True
    assert finished_all is False, "the in-flight node kept running after Stop"


async def test_cancelling_an_unknown_or_finished_run_reports_false(monkeypatch):
    async def quick(node, inputs, effective_formats=None):
        return {"result": 1}

    monkeypatch.setattr(graph_executor, "_execute_node", quick)

    assert run_registry.cancel("does-not-exist") is False

    run = run_registry.start(_chain(1))
    await run.task
    assert run_registry.cancel(run.id) is False


async def test_a_failing_node_leaves_the_run_reportable(monkeypatch):
    async def boom(node, inputs, effective_formats=None):
        raise RuntimeError("node exploded")

    monkeypatch.setattr(graph_executor, "_execute_node", boom)

    run = run_registry.start(_chain(2))
    await run.task
    snapshot = run.snapshot()

    # The engine records per-node errors, so the RUN completes with an error
    # result rather than the task raising.
    assert snapshot["done"] is True
    assert snapshot["result"]["status"] == ExecutionStatus.ERROR.value


# ---------------------------------------------------------------------------
# What a watcher sees below the node level
# ---------------------------------------------------------------------------


def _run_with(events: list) -> run_registry.Run:
    """A Run fed a hand-written progress stream, without executing anything.

    The mapping from event to snapshot is the part worth pinning down; that the
    executor emits those events is `test_batch_concurrency.py`'s job.
    """
    run = run_registry.Run(id="r", total=3)
    for event in events:
        run_registry._apply_progress(run, event)
    return run


def test_batch_counters_reach_the_snapshot():
    run = _run_with([
        {"type": "node_start", "node_id": "a", "label": "Analyse"},
        {"type": "batch_progress", "node_id": "a", "done": 143, "total": 500},
    ])
    snapshot = run.snapshot()
    assert (snapshot["item_done"], snapshot["item_total"]) == (143, 500)
    assert snapshot["current_label"] == "Analyse"


def test_a_new_node_clears_the_previous_node_s_item_count():
    """Carrying 143/500 into a node with no items at all would be a lie."""
    run = _run_with([
        {"type": "node_start", "node_id": "a", "label": "Analyse"},
        {"type": "batch_progress", "node_id": "a", "done": 143, "total": 500},
        {"type": "node_done", "node_id": "a", "status": "success"},
        {"type": "node_start", "node_id": "b", "label": "Write"},
    ])
    snapshot = run.snapshot()
    assert (snapshot["item_done"], snapshot["item_total"]) == (0, 0)


def test_idle_seconds_is_none_until_something_reports():
    assert run_registry.Run(id="r", total=1).snapshot()["idle_seconds"] is None


def test_activity_keeps_idle_seconds_small():
    run = _run_with([
        {"type": "node_start", "node_id": "a", "label": "Ask"},
        {"type": "activity", "node_id": "a", "received": 2048},
    ])
    idle = run.snapshot()["idle_seconds"]
    assert idle is not None and idle < 1.0
