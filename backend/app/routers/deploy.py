"""
Handing a graph to someone else.

The bundle is written by the engine (`engine/src/bundle.ts`) and zipped here.
Nothing about its contents is decided in Python any more: the engine copies
itself verbatim beside the graph, adds the built page when the graph has one,
and writes a README naming only what that particular graph needs.

Why the engine and not this: a bundle a recipient runs must be the code that
was tested, and the engine is what runs graphs. Assembling a second copy here
would make the thing you hand over a sibling of the thing you pressed Run on
rather than the same thing.
"""

from __future__ import annotations

import io
import logging
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models.graph import Graph
from app.services import engine_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/deploy", tags=["deploy"])


def _safe_name(graph: Graph) -> str:
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", graph.metadata.name or "graph").strip("_")
    return name or "graph"


@router.post("/bundle")
async def create_bundle(graph: Graph):
    """Write the bundle with the engine, and return it as a zip."""
    with tempfile.TemporaryDirectory(prefix="ai-graph-bundle-") as work:
        root = Path(work)
        graph_path = root / "graph.json"
        graph_path.write_text(graph.model_dump_json(indent=2), encoding="utf-8")
        out = root / "bundle"

        try:
            node = engine_client.node_command()
        except engine_client.EngineUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc

        finished = subprocess.run(
            [node, str(engine_client.ENGINE_MAIN), str(graph_path), "--bundle", str(out)],
            capture_output=True,
            text=True,
        )
        if finished.returncode != 0:
            # The engine's own message, not a generic failure: it says which
            # part of the graph it could not package.
            raise HTTPException(500, f"The engine could not write the bundle:\n{finished.stderr[-800:]}")

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(out.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(out).as_posix())
        buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{_safe_name(graph)}_bundle.zip"'},
    )
