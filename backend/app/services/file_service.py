"""
File-system service – handles directory listing, file reading, and writing.
"""

from __future__ import annotations

import base64
import csv
import io
import json
import logging
import mimetypes
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def list_directory(path: str, recursive: bool = False, extensions: Optional[List[str]] = None) -> List[str]:
    """Return rooted file paths inside *path*, optionally filtered by file extension."""
    root = Path(path).expanduser().resolve()
    if not root.exists():
        raise FileNotFoundError(f"Directory not found: {path}")
    if not root.is_dir():
        raise NotADirectoryError(f"Not a directory: {path}")

    candidates = root.rglob("*") if recursive else root.iterdir()
    files = [p for p in candidates if p.is_file()]
    allowed = _normalize_extensions(extensions)
    if allowed:
        files = [p for p in files if p.suffix.lower() in allowed]
    return [str(p) for p in files]


def _normalize_extensions(extensions: Optional[List[str]]) -> Optional[set]:
    """Normalize extensions (with or without a leading '.') to a lowercase set."""
    if not extensions:
        return None
    normalized = set()
    for ext in extensions:
        ext = ext.strip().lower()
        if not ext:
            continue
        normalized.add(ext if ext.startswith(".") else f".{ext}")
    return normalized or None


def parse_extensions_filter(raw: str) -> Optional[List[str]]:
    """Parse a user-entered, comma/semicolon/whitespace-separated extension list."""
    if not raw:
        return None
    chunks = raw.replace(";", ",").split(",")
    parts = [part for chunk in chunks for part in chunk.split()]
    return [p for p in parts if p] or None


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


def serialize_text_value(value: Any, format_name: Optional[str]) -> Tuple[str, str]:
    """
    Serialize *value* for a declared text-like *format_name*, returning
    (file_extension, text_payload). Shared by connector debug snapshots and
    format-aware file writing; falls back to str(value)/.txt otherwise.
    """
    normalized = (format_name or "text").lower()
    if normalized in ("json", "application/json"):
        return ".json", json.dumps(value, indent=2, ensure_ascii=False, default=str)
    if normalized in ("csv", "text/csv") and isinstance(value, list) and value and isinstance(value[0], dict):
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=list(value[0]))
        writer.writeheader()
        writer.writerows(value)
        return ".csv", output.getvalue()
    return ".txt", str(value)


def _is_binary_format(format_name: Optional[str]) -> bool:
    normalized = (format_name or "").lower()
    return normalized.startswith("image/") or normalized in ("binary", "application/octet-stream")


def _binary_extension(format_name: Optional[str]) -> str:
    normalized = (format_name or "").lower()
    if normalized.startswith("image/"):
        return mimetypes.guess_extension(normalized) or ".bin"
    return ".bin"


def write_formatted_file(path: str, value: Any, format_name: Optional[str]) -> str:
    """
    Write *value* to *path* using the extension/serialization implied by a
    non-text *format_name* (json/csv/binary/image); the resulting file's
    suffix is derived from the format, replacing whatever suffix *path* has.
    Callers should use write_text_file directly for the plain-text/unset case.
    """
    if _is_binary_format(format_name):
        ext = _binary_extension(format_name)
        data = value if isinstance(value, (bytes, bytearray)) else base64.b64decode(str(value))
        out_path = Path(path).with_suffix(ext)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(bytes(data))
        logger.info("Wrote %d bytes to %s", len(data), out_path)
        return str(out_path)

    ext, content = serialize_text_value(value, format_name)
    out_path = Path(path).with_suffix(ext)
    return write_text_file(str(out_path), content)


def write_output_directory(
    dir_path: str,
    values: Dict[str, Any],
    formats: Optional[Dict[str, Optional[str]]] = None,
    multi_ports: Optional[set] = None,
) -> List[str]:
    """
    Write each collected output value into its own file inside *dir_path*.
    Only ports listed in *multi_ports* have their list values expanded into
    one file per item (matching a genuine multi=True port fed by several
    edges); other ports' values are written as a single file each, even if
    the value itself happens to be a list (e.g. a decoded JSON array) so it
    isn't misread as several accumulated items. Each port's entry in
    *formats* (if any) picks the serialization/extension for its file(s);
    unset/text ports keep the plain str()+.txt behavior.
    Returns the list of written file paths.
    """
    root = Path(dir_path)
    root.mkdir(parents=True, exist_ok=True)

    written: List[str] = []
    index = 0
    for port_id, value in values.items():
        fmt = (formats or {}).get(port_id)
        is_multi = port_id in (multi_ports or set())
        items = value if (is_multi and isinstance(value, list)) else [value]
        multi = len(items) > 1 or len(values) > 1
        for item in items:
            if item is None:
                continue
            stem = f"{port_id}_{index}" if multi else port_id
            if fmt and fmt.lower() != "text":
                out_path = write_formatted_file(str(root / stem), item, fmt)
            else:
                out_path = write_text_file(str(root / f"{stem}.txt"), str(item))
            written.append(out_path)
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
