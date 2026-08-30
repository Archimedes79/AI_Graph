"""
Graph file router: load/save a graph JSON DSL at an absolute server-side path.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.elements.registry import GUI_WIDGET_ELEMENTS, NODE_ELEMENTS
from app.models.graph import Graph
from app.services import file_service, node_files

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/graphs", tags=["graphs"])


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class GraphFileLoadRequest(BaseModel):
    path: str


class GraphFileSaveRequest(BaseModel):
    path: str
    graph: Graph


class FileChangedError(RuntimeError):
    """A node file was edited outside this app since it was last read."""

    def __init__(self, file_name: str):
        super().__init__(file_name)
        self.file_name = file_name


def _authored_items(graph: Graph, directory) -> "list":
    """
    Every file-bearing thing in the graph, as `(folder, Authored)` pairs.

    Nodes and widgets are the same object at two levels, so they are collected
    into one list here and the read/write loops below never learn which is
    which. A gui node authors nothing itself -- it is a composite -- so its slot
    on disk is a folder holding one file per widget.
    """
    items = []
    for node in graph.nodes:
        element = NODE_ELEMENTS.get(node.node_type)
        spec = element.authored_file(node) if element is not None else None
        if spec is not None:
            items.append((directory, node_files.for_node(node, spec)))

        for widget in node.config.gui_widgets:
            widget_element = GUI_WIDGET_ELEMENTS.get(widget.kind)
            widget_spec = widget_element.authored_file(widget) if widget_element is not None else None
            if widget_spec is not None:
                items.append((directory / node_files.slug(node.label), node_files.for_widget(widget, widget_spec)))
    return items


def _read_node_files(graph: Graph, graph_path: str) -> None:
    """
    Fill each authored field from its file. The file is authoritative for what a
    person writes, so this runs on load and the editor never sees a stale copy.

    A missing file is left alone rather than blanking the element: a graph whose
    sibling folder was not copied should still open, with whatever the JSON
    still carries, instead of silently losing it.
    """
    directory = node_files.node_dir(graph_path)
    for folder, item in _authored_items(graph, directory):
        if not item.file_name:
            continue
        path = folder / item.file_name
        if not path.is_file():
            logger.warning("%s points at %s, which is not there", item.ident, path)
            continue
        header, body = node_files.parse(path.read_text(encoding="utf-8"), item.file_name)
        node_files.apply(item, header, body)
        node_files.remember(path)


def _write_node_files(graph: Graph, graph_path: str) -> None:
    """
    Write one file per element that has opted into having one, named after the
    element: renaming it on the canvas renames its file, which is the whole
    reason the name is derived from the label rather than the id.
    """
    directory = node_files.node_dir(graph_path)
    taken: dict = {}

    for folder, item in _authored_items(graph, directory):
        current = item.file_name
        if not current:
            continue
        used = taken.setdefault(str(folder), set())
        wanted = node_files.default_file_name(item.label, item.spec.extension, used)
        used.add(wanted)

        folder.mkdir(parents=True, exist_ok=True)
        old_path = folder / current
        new_path = folder / wanted

        # Never overwrite an edit made outside this app. Whoever saved last
        # would otherwise win silently, which is the one outcome a sync
        # mechanism must not produce.
        for candidate in {old_path, new_path}:
            if node_files.changed_since_seen(candidate):
                raise FileChangedError(candidate.name)

        if current != wanted and old_path.is_file() and not new_path.exists():
            old_path.rename(new_path)
        item.file_name = wanted
        new_path.write_text(node_files.render(item, wanted), encoding="utf-8")
        node_files.remember(new_path)


def _without_externalised_body(graph: Graph) -> dict:
    """
    The JSON to write: a node whose text lives in a file does not repeat it here.

    Two copies of the same text is how they start disagreeing, and the diff
    noise -- an escaped one-line JSON string -- is exactly what moving authored
    text into files was for.
    """
    data = graph.model_dump()
    by_id = {n.id: n for n in graph.nodes}

    for raw in data.get("nodes", []):
        node = by_id[raw["id"]]
        config = raw.get("config") or {}
        element = NODE_ELEMENTS.get(node.node_type)
        spec = element.authored_file(node) if element is not None else None
        if spec is not None and (config.get("code_file") or "").strip():
            config[spec.body_field] = ""

        for raw_widget in config.get("gui_widgets") or []:
            widget = next((w for w in node.config.gui_widgets if w.id == raw_widget.get("id")), None)
            if widget is None or not (raw_widget.get("code_file") or "").strip():
                continue
            widget_element = GUI_WIDGET_ELEMENTS.get(widget.kind)
            widget_spec = widget_element.authored_file(widget) if widget_element is not None else None
            if widget_spec is not None:
                raw_widget[widget_spec.body_field] = ""
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
    except FileChangedError as exc:
        raise HTTPException(409, (
            f"{exc.file_name} was changed outside the editor since it was opened. "
            "Reload the node files to take those changes, or save to a different path."
        )) from exc
    try:
        file_service.write_file(resolved, json.dumps(_without_externalised_body(payload.graph), indent=2, default=str))
    except OSError as exc:
        raise HTTPException(400, f"Could not write graph file: {exc}") from exc
    return {"path": resolved, "graph": payload.graph.model_dump()}


@router.post("/file/reload-nodes")
async def reload_node_files(payload: GraphFileLoadRequest):
    """
    Re-read the node files for an already-open graph.

    The editor reads them when a graph is opened, so this is only for the case
    the conflict check exists for: edited outside while the editor was open.
    """
    resolved = file_service.resolve_path(payload.path)
    try:
        raw = file_service.read_file(resolved, mode="text")
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    graph = Graph.model_validate_json(raw)
    _read_node_files(graph, resolved)
    return {"path": resolved, "graph": graph.model_dump()}
