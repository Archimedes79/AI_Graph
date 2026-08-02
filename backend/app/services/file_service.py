"""
File-system service – handles directory listing, file reading, and writing.
"""

from __future__ import annotations

import base64
import logging
import mimetypes
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def list_directory(path: str, recursive: bool = False) -> List[str]:
    """Return rooted file paths inside *path*."""
    root = Path(path).expanduser().resolve()
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


def read_binary_file_base64(path: str) -> str:
    """Read a file's bytes and return them base64-encoded."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")
    return base64.b64encode(p.read_bytes()).decode("ascii")


def write_text_file(path: str, content: str) -> str:
    """Write *content* to *path*, creating parent directories as needed."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    logger.info("Wrote %d bytes to %s", len(content), path)
    return str(p)


def write_output_directory(dir_path: str, values: Dict[str, Any]) -> List[str]:
    """
    Write each collected output value into its own file inside *dir_path*.
    Lists are expanded into one file per item; scalars become a single file.
    Returns the list of written file paths.
    """
    root = Path(dir_path)
    root.mkdir(parents=True, exist_ok=True)

    written: List[str] = []
    index = 0
    for port_id, value in values.items():
        items = value if isinstance(value, list) else [value]
        for item in items:
            if item is None:
                continue
            name = f"{port_id}_{index}.txt" if len(items) > 1 or len(values) > 1 else f"{port_id}.txt"
            out_path = root / name
            out_path.write_text(str(item), encoding="utf-8")
            written.append(str(out_path))
            index += 1

    logger.info("Wrote %d file(s) to %s", len(written), dir_path)
    return written


def detect_format(path: str) -> str:
    """Heuristically propose a Port.format value for *path*: a specific MIME type
    when recognizable via extension, else 'text' or 'binary' based on decodability."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")

    if p.suffix.lower() == ".csv":
        return "csv"

    mime, _ = mimetypes.guess_type(str(p))
    if mime and mime != "application/octet-stream":
        if mime == "application/json":
            return "json"
        if mime == "text/csv":
            return "csv"
        if not mime.startswith("text/"):
            return mime

    try:
        with p.open("rb") as f:
            chunk = f.read(8192)
        chunk.decode("utf-8")
        return "text"
    except UnicodeDecodeError:
        return "binary"


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
