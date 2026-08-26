"""
Graph CRUD + DSL import/export router.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.models.graph import Graph
from app.services import file_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/graphs", tags=["graphs"])

# In-memory store (replace with a DB in production)
_store: Dict[str, Graph] = {}


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


@router.get("/", response_model=List[Dict])
async def list_graphs():
    return [
        {
            "id": gid,
            "name": g.metadata.name,
            "description": g.metadata.description,
            "updated_at": g.metadata.updated_at,
        }
        for gid, g in _store.items()
    ]


@router.post("/", response_model=Dict)
async def create_graph(graph: Graph):
    if not graph.metadata.created_at:
        graph.metadata.created_at = _now()
    graph.metadata.updated_at = _now()
    gid = f"graph-{len(_store) + 1}"
    _store[gid] = graph
    return {"id": gid, **graph.model_dump()}


@router.get("/{graph_id}", response_model=Dict)
async def get_graph(graph_id: str):
    if graph_id not in _store:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    return {"id": graph_id, **_store[graph_id].model_dump()}


@router.put("/{graph_id}", response_model=Dict)
async def update_graph(graph_id: str, graph: Graph):
    if graph_id not in _store:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    graph.metadata.updated_at = _now()
    _store[graph_id] = graph
    return {"id": graph_id, **graph.model_dump()}


@router.delete("/{graph_id}")
async def delete_graph(graph_id: str):
    if graph_id not in _store:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    del _store[graph_id]
    return {"deleted": graph_id}


@router.get("/{graph_id}/export")
async def export_graph(graph_id: str):
    """Export the graph as the JSON DSL."""
    if graph_id not in _store:
        raise HTTPException(404, f"Graph '{graph_id}' not found")
    return PlainTextResponse(
        _store[graph_id].model_dump_json(indent=2),
        media_type="application/json",
    )


@router.post("/import")
async def import_graph(file: UploadFile = File(...)):
    """Import a graph from an uploaded JSON DSL file."""
    raw = await file.read()
    try:
        graph = Graph.model_validate_json(raw)
    except Exception as exc:
        raise HTTPException(400, f"Invalid graph JSON: {exc}") from exc
    graph.metadata.updated_at = _now()
    gid = f"graph-{len(_store) + 1}"
    _store[gid] = graph
    return {"id": gid, **graph.model_dump()}


class GraphFileLoadRequest(BaseModel):
    path: str


class GraphFileSaveRequest(BaseModel):
    path: str
    graph: Graph


@router.post("/file/load")
async def load_graph_file(payload: GraphFileLoadRequest):
    """Read a graph JSON DSL from an absolute server-side path (the editor's "Load")."""
    resolved = file_service.resolve_path(payload.path)
    try:
        raw = file_service.read_file(resolved, mode="text")
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    try:
        graph = Graph.model_validate_json(raw)
    except Exception as exc:
        raise HTTPException(400, f"Invalid graph JSON: {exc}") from exc
    return {"path": resolved, "graph": graph.model_dump()}


@router.post("/file/save")
async def save_graph_file(payload: GraphFileSaveRequest):
    """Write the graph JSON DSL to an absolute server-side path (the editor's "Save"/"Save
    As"), so subsequent saves round-trip to the same file a graph was loaded from."""
    resolved = file_service.resolve_path(payload.path)
    payload.graph.metadata.updated_at = _now()
    try:
        file_service.write_file(resolved, payload.graph.model_dump_json(indent=2))
    except OSError as exc:
        raise HTTPException(400, f"Could not write graph file: {exc}") from exc
    return {"path": resolved}
