"""
AI-Graph backend – FastAPI application entry point.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import ai, deploy, execute, files, graph

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app = FastAPI(
    title="AI-Graph API",
    version="1.0.0",
    description=(
        "No-code, node-based AI workflow orchestration platform. "
        "Define graphs via a JSON DSL, execute them with AI and code nodes, "
        "and deploy them anywhere."
    ),
)

# Allow the frontend dev server (and same-origin) to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graph.router)
app.include_router(execute.router)
app.include_router(ai.router)
app.include_router(deploy.router)
app.include_router(files.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ai-graph-backend"}


# Optional single-process production mode: if a built frontend exists at
# frontend/dist (repo_root/frontend/dist), serve it on the same port as the
# API. Registered last so it never shadows the /api/* routers above. No-op
# (dev mode unaffected) when the directory doesn't exist, e.g. local dev.
# In a PyInstaller build the repo layout is gone and everything the exe ships
# sits under sys._MEIPASS instead (see build_editor_exe.py).
if getattr(sys, "frozen", False):
    _frontend_dist = Path(sys._MEIPASS) / "frontend" / "dist"
else:
    _frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"

_serves_frontend = _frontend_dist.is_dir()

# Only claim "/" when there is no UI to serve there. An explicit route always
# wins over a mount, so registering this unconditionally would hand the editor's
# own entry point a JSON blob instead of index.html.
if not _serves_frontend:

    @app.get("/")
    async def root():
        return {
            "message": "AI-Graph API is running",
            "docs": "/docs",
            "redoc": "/redoc",
        }

else:
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
