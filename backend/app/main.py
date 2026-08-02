"""
AI-Graph backend – FastAPI application entry point.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


@app.get("/")
async def root():
    return {
        "message": "AI-Graph API is running",
        "docs": "/docs",
        "redoc": "/redoc",
    }
