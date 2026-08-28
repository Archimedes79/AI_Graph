"""
A node's authored text as a real file beside the graph.

A graph used to be one JSON file with its code embedded as escaped strings: a
one-line change showed up in `git diff` as a rewritten JSON line full of `\\n`,
and editing it meant a textarea in a modal while a real editor -- with a
language server, a linter and the rest -- sat unused two windows away.

So a project is a graph plus one text file per authored node. The graph keeps
the wiring and points at the file (`config.code_file`); the file keeps what a
person writes. The engine is untouched: `config.code` is still what executes,
and the router fills it in from the file on load.

The file carries a header comment with the prompt and the context it was
generated from, so it stands on its own -- opening `analyse.py` tells you what
it is for without opening the graph. Which of those fields flow back is
deliberate and narrow (see `AUTHORITATIVE_KEYS`): the body, the prompt and the
context file are authored, so the file wins. Ports are derived from the wiring
and are written into the header purely so you can see them while writing
`run(inputs)` -- letting a text file rename a port would silently break edges.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

# Comment prefix per extension. A node type whose file is prose (an ai node's
# system prompt) gets its own entry rather than being forced into code syntax.
_COMMENT_PREFIX = {".py": "#", ".js": "//"}

BANNER = "--- ai-graph ---"
_BANNER_END = "-" * 8

# Header fields the file owns. Everything else in the header is regenerated on
# every write and ignored on read.
AUTHORITATIVE_KEYS = ("node", "prompt", "context-file")


def comment_prefix(file_name: str) -> str:
    return _COMMENT_PREFIX.get(Path(file_name).suffix.lower(), "#")


def slug(label: str) -> str:
    """
    A file name from a node label, because the point of files is that the file
    tree reads like the graph. Everything a filesystem dislikes becomes an
    underscore; the result is never empty.
    """
    cleaned = re.sub(r"[^\w\-. ]", "", label, flags=re.UNICODE).strip()
    cleaned = re.sub(r"[\s.]+", "_", cleaned).strip("_")
    return cleaned or "node"


def default_file_name(label: str, language: str, taken: Optional[set] = None) -> str:
    """
    `Analyse` + python -> `Analyse.py`, made unique against *taken*.

    Two nodes may carry the same label -- nothing stops that -- so a numeric
    suffix is the price of keeping the name readable rather than hashing an id
    into it.
    """
    extension = ".js" if str(language).lower().startswith(("js", "javascript", "node")) else ".py"
    base = slug(label)
    candidate = f"{base}{extension}"
    taken = taken or set()
    index = 2
    while candidate.lower() in {t.lower() for t in taken}:
        candidate = f"{base}_{index}{extension}"
        index += 1
    return candidate


def _header_lines(node, file_name: str) -> list:
    """The header, as plain `key: value` lines (no YAML parser on either side)."""
    prefix = comment_prefix(file_name)
    opening = f"{prefix} {BANNER}{_BANNER_END}"
    # A plain rule to close with: repeating the banner reads like a second
    # header starting rather than the first one ending.
    closing = f"{prefix} {'-' * (len(BANNER) + len(_BANNER_END))}"

    lines = [opening, f"{prefix} node:    {node.label}", f"{prefix} id:      {node.id}"]

    prompt = (getattr(node.config, "code_prompt", "") or "").strip()
    if prompt:
        lines.append(f"{prefix} prompt: |")
        lines.extend(f"{prefix}   {line}" for line in prompt.splitlines())

    context_file = (getattr(node.config, "config_context_file", "") or "").strip()
    if context_file:
        lines.append(f"{prefix} context-file: {context_file}")

    # Informational: regenerated every write, never read back.
    if node.inputs:
        lines.append(f"{prefix} inputs:  {', '.join(p.id for p in node.inputs)}")
    if node.outputs:
        lines.append(f"{prefix} outputs: {', '.join(p.id for p in node.outputs)}")
    lines.append(closing)
    return lines


def render(node, file_name: str) -> str:
    """The full file: header comment, blank line, then the node's own code."""
    body = (getattr(node.config, "code", "") or "").rstrip("\n")
    return "\n".join(_header_lines(node, file_name)) + "\n\n" + body + "\n"


def parse(text: str, file_name: str = "node.py") -> Tuple[Dict[str, Any], str]:
    """
    Split a node file into `(header, body)`.

    A file with no recognisable header is not an error: it is a file somebody
    wrote by hand, and its whole content is the body. Being lenient here is what
    lets the format be edited by a person rather than only by this module.
    """
    prefix = comment_prefix(file_name)
    lines = text.splitlines()
    if not lines or BANNER not in lines[0]:
        return {}, text.rstrip("\n")

    header: Dict[str, Any] = {}
    key_of_block: Optional[str] = None
    block: list = []
    end = len(lines)

    for index, raw in enumerate(lines[1:], start=1):
        stripped = raw.strip()
        if not stripped.startswith(prefix):
            end = index
            break
        content = stripped[len(prefix):]
        if BANNER in content or set(content.strip()) == {"-"}:
            end = index + 1
            break

        if key_of_block is not None and (content.startswith("   ") or not content.strip()):
            block.append(content[3:] if content.startswith("   ") else "")
            continue
        if key_of_block is not None:
            header[key_of_block] = "\n".join(block).strip("\n")
            key_of_block, block = None, []

        match = re.match(r"\s*([\w-]+):\s*(.*)$", content)
        if not match:
            continue
        key, value = match.group(1).strip(), match.group(2).strip()
        if value == "|":
            key_of_block, block = key, []
        else:
            header[key] = value

    if key_of_block is not None:
        header[key_of_block] = "\n".join(block).strip("\n")

    body = "\n".join(lines[end:]).strip("\n")
    return header, body


def apply_to_node(node, header: Dict[str, Any], body: str) -> None:
    """
    Write a parsed file back onto a node -- authored fields only.

    `id` is the key that matched this file to this node and is never applied;
    ports are derived from the wiring, so a header that disagrees with them is
    stale text, not an instruction.
    """
    node.config.code = body
    if "node" in header and header["node"]:
        node.label = header["node"]
    if "prompt" in header:
        node.config.code_prompt = header["prompt"]
    if "context-file" in header:
        node.config.config_context_file = header["context-file"]


def node_dir(graph_path: str) -> Path:
    """`my_graph.json` -> `my_graph.nodes/`, beside it."""
    path = Path(graph_path)
    return path.parent / f"{path.stem}.nodes"
