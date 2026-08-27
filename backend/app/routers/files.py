"""
Lightweight file utility endpoints.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, HTTPException, UploadFile

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


@router.post("/browse")
async def browse(payload: dict):
    """
    List a directory on the machine the engine runs on, for the file/directory
    pickers. A browser never reveals a chosen file's real location, so a picker
    that must produce a path the engine can resolve has to browse server-side.
    """
    try:
        return file_service.browse_directory(
            payload.get("path") or "",
            file_service.parse_extensions_filter(payload.get("extensions") or ""),
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, f"Not permitted to read that directory: {exc}") from exc
    except OSError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/attachments")
async def upload_attachment(file: UploadFile = File(...)):
    """Save an uploaded context-file attachment inside the project, returning its path."""
    content = await file.read()
    path = file_service.save_attachment(file.filename or "attachment", content)
    return {"path": path, "name": file.filename}


@router.delete("/attachments")
async def remove_attachment(path: str):
    """Delete a previously uploaded attachment."""
    try:
        file_service.delete_attachment(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True}

