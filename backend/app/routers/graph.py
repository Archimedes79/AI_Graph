"""
Graph CRUD + DSL import/export router.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.models.graph import Graph
from app.services import file_service, node_files

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


def _read_node_files(graph: Graph, graph_path: str) -> None:
    """
    Fill each node's `code` from its file. The file is authoritative for what a
    person authors, so this runs on load and the editor never sees a stale copy.

    A missing file is left alone rather than blanking the node: a graph whose
    sibling folder was not copied should still open, with whatever code the JSON
    still carries, instead of silently losing it.
    """
    directory = node_files.node_dir(graph_path)
    for node in graph.nodes:
        name = (getattr(node.config, "code_file", "") or "").strip()
        if not name:
            continue
        path = directory / name
        if not path.is_file():
            logger.warning("Node %s points at %s, which is not there", node.id, path)
            continue
        header, body = node_files.parse(path.read_text(encoding="utf-8"), name)
        node_files.apply_to_node(node, header, body)


def _write_node_files(graph: Graph, graph_path: str) -> None:
    """
    Write one file per node that has opted into having one, and keep the file
    named after the node: renaming a node on the canvas renames its file, which
    is the whole reason the name is derived from the label rather than the id.
    """
    directory = node_files.node_dir(graph_path)
    taken: set = set()

    for node in graph.nodes:
        current = (getattr(node.config, "code_file", "") or "").strip()
        if not current:
            continue
        wanted = node_files.default_file_name(node.label, node.config.language, taken)
        taken.add(wanted)

        directory.mkdir(parents=True, exist_ok=True)
        old_path = directory / current
        new_path = directory / wanted
        if current != wanted and old_path.is_file() and not new_path.exists():
            old_path.rename(new_path)
        node.config.code_file = wanted
        new_path.write_text(node_files.render(node, wanted), encoding="utf-8")


def _without_externalised_code(graph: Graph) -> dict:
    """
    The JSON to write: a node whose code lives in a file does not repeat it here.

    Two copies of the same text is how they start disagreeing, and the diff
    noise -- an escaped one-line JSON string -- is exactly what moving code into
    files was for.
    """
    data = graph.model_dump()
    for node in data.get("nodes", []):
        config = node.get("config") or {}
        if (config.get("code_file") or "").strip():
            config["code"] = ""
    return data


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
    _read_node_files(graph, resolved)
    return {"path": resolved, "graph": graph.model_dump()}


@router.post("/file/save")
async def save_graph_file(payload: GraphFileSaveRequest):
    """Write the graph JSON DSL to an absolute server-side path (the editor's "Save"/"Save
    As"), so subsequent saves round-trip to the same file a graph was loaded from."""
    resolved = file_service.resolve_path(payload.path)
    payload.graph.metadata.updated_at = _now()
    try:
        _write_node_files(payload.graph, resolved)
        file_service.write_file(resolved, json.dumps(_without_externalised_code(payload.graph), indent=2, default=str))
    except OSError as exc:
        raise HTTPException(400, f"Could not write graph file: {exc}") from exc
    return {"path": resolved, "graph": payload.graph.model_dump()}
