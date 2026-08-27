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
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def _default_attachments_dir() -> Path:
    """
    Project-local storage for uploaded "context file" attachments. A frozen
    build's own directory tree is a temp dir that is deleted on exit, so a
    packaged editor stores them next to the executable instead.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "data" / "attachments"
    return Path(__file__).resolve().parents[2] / "data" / "attachments"


# See routers/files.py.
ATTACHMENTS_DIR = Path(os.getenv("ATTACHMENTS_DIR", str(_default_attachments_dir())))


def save_attachment(filename: str, content: bytes) -> str:
    """Persist an uploaded attachment under ATTACHMENTS_DIR and return its path."""
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex}_{Path(filename).name}"
    dest = ATTACHMENTS_DIR / safe_name
    dest.write_bytes(content)
    return str(dest)


def delete_attachment(path: str) -> None:
    """Remove a previously saved attachment; refuses to touch anything outside ATTACHMENTS_DIR."""
    target = Path(path).expanduser().resolve()
    if ATTACHMENTS_DIR.resolve() not in target.parents:
        raise ValueError("Refusing to delete a path outside the attachments directory")
    target.unlink(missing_ok=True)


def resolve_path(raw: "str | List[str]") -> str:
    """Expand '~' and resolve a config/widget/input-supplied path string to an
    absolute one. If *raw* is a list (e.g. a multi-file port wired into a
    single-path consumer), only the first entry is used."""
    if isinstance(raw, list):
        raw = raw[0] if raw else ""
    return str(Path(raw).expanduser().resolve())


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


def _filesystem_roots() -> List[str]:
    """Top-level places a browser should offer to jump to: the user's home, plus
    the drives that actually exist on Windows and `/` everywhere else."""
    roots: List[str] = [str(Path.home())]
    if os.name == "nt":
        roots += [f"{letter}:\\" for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if Path(f"{letter}:\\").exists()]
    else:
        roots.append("/")
    return roots


def browse_directory(path: str = "", extensions: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    One page of a server-side file browser: the resolved directory, its parent,
    and its immediate children.

    This exists because the engine resolves REAL paths, while a browser's
    `<input type="file">` only ever reveals a file's name -- so a picker has to
    browse the machine the graph will actually run on, not the one the UI is
    displayed on. Callers decide whether offering it is appropriate (see
    graph-runner/serve.py, which only exposes it on a loopback bind).

    An empty *path* starts at the user's home directory. Entries that cannot be
    read are skipped rather than failing the whole listing, since one
    permission-denied entry should not make a directory unbrowsable.
    """
    root = Path(path).expanduser().resolve() if path else Path.home()
    if not root.exists():
        raise FileNotFoundError(f"Directory not found: {root}")
    if not root.is_dir():
        root = root.parent

    allowed = _normalize_extensions(extensions)
    directories: List[Dict[str, Any]] = []
    files: List[Dict[str, Any]] = []
    for child in root.iterdir():
        try:
            is_dir = child.is_dir()
        except OSError:
            continue
        if is_dir:
            directories.append({"name": child.name, "path": str(child), "is_dir": True})
        elif not allowed or child.suffix.lower() in allowed:
            files.append({"name": child.name, "path": str(child), "is_dir": False})

    directories.sort(key=lambda e: e["name"].lower())
    files.sort(key=lambda e: e["name"].lower())

    parent = str(root.parent) if root.parent != root else None
    return {"path": str(root), "parent": parent, "entries": directories + files, "roots": _filesystem_roots()}


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


def read_file(path: "str | List[str]", mode: str = "text") -> str:
    """Read a single file, either as UTF-8 text (`mode="text"`) or as
    base64-encoded bytes (`mode="binary"`). If *path* is a list (a multi-file
    port wired into a single-file read), only the first entry is read --
    use `read_batch` to read every item instead."""
    if isinstance(path, list):
        path = path[0] if path else ""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")
    if mode == "binary":
        return base64.b64encode(p.read_bytes()).decode("ascii")
    return p.read_text(encoding="utf-8", errors="replace")


def read_batch(paths: List[Optional[str]], mode: str = "text") -> List[Optional[str]]:
    """Read every path in *paths* (text or binary, per `read_file`), preserving
    `None` entries positionally so results still line up with their inputs."""
    return [read_file(path, mode) if path is not None else None for path in paths]


def write_file(path: str, content: Any, mode: str = "text") -> str:
    """Write a single file, creating parent directories as needed. `mode="text"`
    writes *content* as UTF-8 (coercing non-str values via `str()`); `mode="binary"`
    writes *content* as raw bytes, base64-decoding it first if it's given as a str."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    if mode == "binary":
        data = content if isinstance(content, (bytes, bytearray)) else base64.b64decode(str(content))
        p.write_bytes(bytes(data))
        logger.info("Wrote %d bytes to %s", len(data), path)
    else:
        text = content if isinstance(content, str) else str(content)
        p.write_text(text, encoding="utf-8")
        logger.info("Wrote %d bytes to %s", len(text), path)
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
    Write *value* to *path* using the extension/serialization implied by
    *format_name* (json/csv/binary/image, or plain text if unset); the
    resulting file's suffix is derived from the format, replacing whatever
    suffix *path* has. Delegates the actual disk write to `write_file`.
    """
    if _is_binary_format(format_name):
        ext = _binary_extension(format_name)
        out_path = str(Path(path).with_suffix(ext))
        return write_file(out_path, value, mode="binary")

    ext, content = serialize_text_value(value, format_name)
    out_path = str(Path(path).with_suffix(ext))
    return write_file(out_path, content, mode="text")


def write_batch(
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
                out_path = write_file(str(root / f"{stem}.txt"), str(item), mode="text")
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

