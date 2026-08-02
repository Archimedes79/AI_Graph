"""
Lightweight file utility endpoints.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.services import file_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/files", tags=["files"])


@router.post("/detect-format")
async def detect_format(payload: dict):
    """Propose a Port.format value for the file at payload["path"]."""
    path = payload.get("path")
    if not path:
        raise HTTPException(400, "Missing required field 'path'")
    try:
        fmt = file_service.detect_format(path)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"format": fmt}
