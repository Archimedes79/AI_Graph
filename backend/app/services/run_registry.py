"""
In-flight graph runs, so a run can be watched and stopped.

`execute_graph` is one long await. Called directly from a request handler that
makes a run a black box: nothing reports which node is busy, and the only way
out of a ten-minute call against a slow local model is to reload the page --
which abandons the request without stopping the work behind it.

A run is therefore started as an asyncio task and kept here under an id. The
caller polls for progress and can cancel, which cancels the task: `CancelledError`
propagates out of the node currently awaiting, aborting its HTTP request rather
than letting it run to completion unwatched.

This is deliberately in-memory and single-process. It is not a job queue --
runs do not survive a restart, and are not meant to: the editor and a deployed
tool are one process serving one person at a keyboard.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from app.models.graph import ExecutionResult, ExecutionStatus, Graph
from app.services.graph_executor import execute_graph

logger = logging.getLogger(__name__)

# Finished runs are kept briefly so a poll that arrives after completion still
# finds the result, then dropped so a long editing session cannot accumulate them.
COMPLETED_RUN_TTL = 300.0
MAX_RUNS = 32


@dataclass
class Run:
    id: str
    total: int
    completed: int = 0
    running: List[str] = field(default_factory=list)
    current_label: str = ""
    result: Optional[ExecutionResult] = None
    error: Optional[str] = None
    cancelled: bool = False
    finished_at: Optional[float] = None
    task: Optional[asyncio.Task] = field(default=None, repr=False)

    @property
    def done(self) -> bool:
        return self.result is not None or self.error is not None or self.cancelled

    def snapshot(self) -> Dict[str, Any]:
        """What a polling client needs, and nothing that cannot be serialised."""
        return {
            "run_id": self.id,
            "done": self.done,
            "cancelled": self.cancelled,
            "completed": self.completed,
            "total": self.total,
            "running": list(self.running),
            "current_label": self.current_label,
            "error": self.error,
            "result": self.result.model_dump() if self.result is not None else None,
        }


_runs: Dict[str, Run] = {}


def _prune() -> None:
    """Drop finished runs once they are stale, oldest first if still over the cap."""
    now = time.monotonic()
    for run_id, run in list(_runs.items()):
        if run.finished_at is not None and now - run.finished_at > COMPLETED_RUN_TTL:
            del _runs[run_id]
    while len(_runs) > MAX_RUNS:
        oldest = min(_runs.values(), key=lambda r: r.finished_at or float("inf"))
        if oldest.finished_at is None:
            break  # everything left is still running; never evict a live run
        del _runs[oldest.id]


def start(graph: Graph) -> Run:
    """Begin executing *graph* in the background and return its Run handle."""
    _prune()
    run = Run(id=uuid.uuid4().hex, total=len(graph.nodes))

    def on_progress(event: Dict[str, Any]) -> None:
        if event.get("type") == "node_start":
            run.running.append(event["node_id"])
            run.current_label = event.get("label") or event["node_id"]
        elif event.get("type") == "node_done":
            run.completed += 1
            if event["node_id"] in run.running:
                run.running.remove(event["node_id"])

    async def execute() -> None:
        try:
            run.result = await execute_graph(graph, on_progress=on_progress)
        except asyncio.CancelledError:
            run.cancelled = True
            raise
        except Exception as exc:  # noqa: BLE001 - reported to the client, not swallowed
            logger.exception("Run %s failed", run.id)
            run.error = str(exc)
        finally:
            run.running = []
            run.finished_at = time.monotonic()

    run.task = asyncio.ensure_future(execute())
    _runs[run.id] = run
    return run


def get(run_id: str) -> Optional[Run]:
    return _runs.get(run_id)


def cancel(run_id: str) -> bool:
    """Stop a run. Returns False if it is unknown or already finished."""
    run = _runs.get(run_id)
    if run is None or run.task is None or run.task.done():
        return False
    run.cancelled = True
    run.task.cancel()
    return True


def cancelled_result() -> ExecutionResult:
    """The result a cancelled run reports, so the client has something to show."""
    return ExecutionResult(
        status=ExecutionStatus.CANCELLED,
        node_results=[],
        final_outputs={},
        error="Run stopped.",
    )


def reset() -> None:
    """Drop every run. For tests."""
    _runs.clear()
