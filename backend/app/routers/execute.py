"""
Graph execution router.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.models.graph import ExecutionResult, Graph, RuntimeRequirement
from app.services import graph_executor, run_registry

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/execute", tags=["execute"])


@router.post("/requirements", response_model=list[RuntimeRequirement])
async def get_requirements(graph: Graph):
    """Return the file/directory paths that must be supplied before running."""
    return graph_executor.get_runtime_requirements(graph)


@router.post("/", response_model=ExecutionResult)
async def execute_graph(graph: Graph):
    """Execute the provided graph and return the full execution result."""
    result = await graph_executor.execute_graph(graph)
    return result


# --- Watchable, stoppable runs ------------------------------------------------
#
# POST / above stays: the CLI, the deploy bundle and any script calling the API
# want one call that returns the result. The editor uses these three instead, so
# it can show which node is busy and offer a Stop button.

@router.post("/start")
async def start_run(graph: Graph):
    """Begin a run in the background and return its id."""
    run = run_registry.start(graph)
    return {"run_id": run.id, "total": run.total}


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    """Progress while a run is in flight; the full result once it is done."""
    run = run_registry.get(run_id)
    if run is None:
        raise HTTPException(404, f"No run '{run_id}' (it may have finished long ago)")
    snapshot = run.snapshot()
    if run.cancelled and snapshot["result"] is None:
        snapshot["result"] = run_registry.cancelled_result().model_dump()
    return snapshot


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    """Stop a run. Nodes already finished keep their results."""
    return {"cancelled": run_registry.cancel(run_id)}


@router.post("/{graph_id}", response_model=ExecutionResult)
async def execute_stored_graph(graph_id: str):
    """Execute a previously stored graph by its ID."""
    from app.routers.graph import _store  # local import to avoid circular deps

    if graph_id not in _store:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    result = await graph_executor.execute_graph(_store[graph_id])
    return result
