"""
File-system service – handles directory listing, file reading, image encoding.
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import os
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def list_directory(path: str, recursive: bool = False) -> List[str]:
    """Return a list of file paths inside *path*."""
    root = Path(path)
    if not root.exists():
        raise FileNotFoundError(f"Directory not found: {path}")
    if not root.is_dir():
        raise NotADirectoryError(f"Not a directory: {path}")

    if recursive:
        return [str(p) for p in root.rglob("*") if p.is_file()]
    return [str(p) for p in root.iterdir() if p.is_file()]


def read_text_file(path: str) -> str:
    """Read and return the contents of a text file."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")
    return p.read_text(encoding="utf-8", errors="replace")


def read_image_base64(path: str) -> Dict[str, Any]:
    """Read an image file and return base64 data with mime type."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Image not found: {path}")
    mime, _ = mimetypes.guess_type(str(p))
    mime = mime or "application/octet-stream"
    data = p.read_bytes()
    return {
        "path": str(p),
        "name": p.name,
        "mime_type": mime,
        "base64": base64.b64encode(data).decode(),
        "size_bytes": len(data),
    }


def write_text_file(path: str, content: str) -> str:
    """Write *content* to *path*, creating parent directories as needed."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    logger.info("Wrote %d bytes to %s", len(content), path)
    return str(p)


def file_info(path: str) -> Dict[str, Any]:
    """Return metadata about a file."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Path not found: {path}")
    stat = p.stat()
    mime, _ = mimetypes.guess_type(str(p))
    return {
        "path": str(p),
        "name": p.name,
        "size_bytes": stat.st_size,
        "is_file": p.is_file(),
        "is_dir": p.is_dir(),
        "mime_type": mime,
        "extension": p.suffix,
    }
