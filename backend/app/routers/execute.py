"""
Running a graph — forwarded to the engine.

The editor does not execute graphs. It hands them to the TypeScript engine,
which is the same engine a deploy bundle carries, so pressing Run in the editor
and running the tool someone was handed are the same code doing the same thing.
That equivalence is the point: a second implementation would be right on the
day it was written and wrong by the following week.

These four routes are a forwarding layer and nothing more. The shapes are the
engine's, and the page's `RunSnapshot` reads them directly.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException

from app.models.graph import Graph
from app.services import engine_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/execute", tags=["execute"])


def _unavailable(exc: Exception) -> HTTPException:
    """The engine could not be reached, said as something to act on."""
    return HTTPException(503, str(exc))


@router.post("/requirements")
async def get_requirements(graph: Graph):
    """The file and directory paths that must be supplied before running."""
    try:
        return await engine_client.post("/api/execute/requirements", graph.model_dump())
    except (engine_client.EngineUnavailable, httpx.HTTPError) as exc:
        raise _unavailable(exc) from exc


@router.post("/")
async def execute_graph(graph: Graph):
    """Run the graph and return the whole result. One call, for scripts."""
    try:
        return await engine_client.post("/api/execute/", graph.model_dump())
    except (engine_client.EngineUnavailable, httpx.HTTPError) as exc:
        raise _unavailable(exc) from exc


# --- Watchable, stoppable runs ------------------------------------------------
#
# POST / above stays for anything that wants one blocking call. The editor uses
# these three so it can show which node is busy and offer a Stop button.

@router.post("/start")
async def start_run(graph: Graph):
    """Begin a run in the background and return its id."""
    try:
        return await engine_client.post("/api/execute/start", graph.model_dump())
    except (engine_client.EngineUnavailable, httpx.HTTPError) as exc:
        raise _unavailable(exc) from exc


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    """Progress while a run is in flight; the full result once it is done."""
    try:
        return await engine_client.get(f"/api/execute/runs/{run_id}")
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(404, f"No run '{run_id}' (it may have finished long ago)") from exc
        raise _unavailable(exc) from exc
    except (engine_client.EngineUnavailable, httpx.HTTPError) as exc:
        raise _unavailable(exc) from exc


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    """Stop a run. Nodes already finished keep their results."""
    try:
        return await engine_client.post(f"/api/execute/runs/{run_id}/cancel", {})
    except (engine_client.EngineUnavailable, httpx.HTTPError) as exc:
        raise _unavailable(exc) from exc
