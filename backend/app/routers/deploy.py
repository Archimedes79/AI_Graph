"""
Deployment router – generate deploy bundles (vendored runtime + graph.json)
and their accompanying Docker Compose stack.
"""

from __future__ import annotations

import zipfile
import io

from fastapi import APIRouter
from fastapi.responses import Response, PlainTextResponse

from app.models.graph import Graph
from app.services import deploy_service

router = APIRouter(prefix="/api/deploy", tags=["deploy"])


@router.post("/bundle")
async def create_bundle(graph: Graph):
    """
    Generate a deployment bundle (zip archive) containing:
      - app/**             – the real AI-Graph execution engine, vendored verbatim
      - graph.json         – the graph definition
      - main.py            – entrypoint (graph-runner/run.py, verbatim)
      - requirements.txt / Dockerfile / docker-compose.yml / README.md
    """
    bundle = deploy_service.generate_deployment_bundle(graph)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, content in bundle.items():
            zf.writestr(filename, content)
    buf.seek(0)

    safe_name = graph.metadata.name.lower().replace(" ", "_")
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_bundle.zip"'},
    )


@router.post("/docker-compose")
async def get_docker_compose(graph: Graph):
    """Return the docker-compose.yml for the graph."""
    return PlainTextResponse(
        deploy_service.generate_docker_compose(graph),
        media_type="text/yaml",
    )
