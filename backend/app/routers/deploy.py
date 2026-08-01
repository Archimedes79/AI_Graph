"""
Deployment router – generate Docker Compose stacks and runner scripts.
"""

from __future__ import annotations

import zipfile
import io
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, PlainTextResponse

from app.models.graph import Graph
from app.services import deploy_service

router = APIRouter(prefix="/api/deploy", tags=["deploy"])


@router.post("/bundle")
async def create_bundle(graph: Graph):
    """
    Generate a deployment bundle (zip archive) containing:
      - run_graph.py     – compiled, self-contained executable (no graph.json needed)
      - docker-compose.yml
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


@router.post("/runner-script")
async def get_runner_script(graph: Graph):
    """Return a standalone Python runner script for the graph."""
    return PlainTextResponse(
        deploy_service.generate_runner_script(graph),
        media_type="text/x-python",
    )
