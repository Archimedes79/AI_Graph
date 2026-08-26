"""
Graph execution router.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.models.graph import ExecutionResult, Graph, RuntimeRequirement
from app.services import graph_executor

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


@router.post("/{graph_id}", response_model=ExecutionResult)
async def execute_stored_graph(graph_id: str):
    """Execute a previously stored graph by its ID."""
    from app.routers.graph import _store  # local import to avoid circular deps

    if graph_id not in _store:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    result = await graph_executor.execute_graph(_store[graph_id])
    return result
