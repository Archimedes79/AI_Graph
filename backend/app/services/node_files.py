"""
A node's authored text as a real file beside the graph.

A graph used to be one JSON file with its code embedded as escaped strings: a
one-line change showed up in `git diff` as a rewritten JSON line full of `\\n`,
and editing it meant a textarea in a modal while a real editor -- with a
language server, a linter and the rest -- sat unused two windows away.

So a project is a graph plus one text file per authored node. The graph keeps
the wiring and points at the file (`config.code_file`); the file keeps what a
person writes. The engine is untouched: the element's body field is still what
executes, and the router fills it in from the file on load.

**One mechanism, not one per node type.** Every element turns out to have the
same shape -- one authored body, one prompt that produced it -- so each declares
it once via `NodeElement.authored_file()` and everything here is parameterised
by that. A new node type gets files by returning an `AuthoredFile`; nothing in
this module or in the router learns its name.

The file carries a header with the prompt and the context it was generated from,
so it stands on its own -- opening `Analyse.py` tells you what it is for without
opening the graph. Which of those fields flow back is deliberate and narrow:
the body, the prompt, the label and the context file are authored, so the file
wins. Ports are derived from the wiring and are written into the header purely
so you can see them while writing `run(inputs)` -- letting a text file rename a
port would silently break edges.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.services import skeleton

BANNER = "--- ai-graph ---"


@dataclass(frozen=True)
class CommentStyle:
    """How a header is fenced in one kind of file.

    Markdown cannot use `#` (that is a heading), so it gets YAML-style front
    matter -- which is the same `key: value` block under a different fence, and
    the idiomatic thing for the format. One parser serves both.
    """

    prefix: str          # put in front of every header line ("# ", "// ", "")
    opening: str
    closing: str


_PYTHON = CommentStyle(prefix="# ", opening=f"# {BANNER}--------", closing="# " + "-" * 24)
_JAVASCRIPT = CommentStyle(prefix="// ", opening=f"// {BANNER}--------", closing="// " + "-" * 24)
_MARKDOWN = CommentStyle(prefix="", opening="---", closing="---")

_STYLES = {".py": _PYTHON, ".js": _JAVASCRIPT, ".md": _MARKDOWN, ".txt": _MARKDOWN}

# Header keys the file owns; everything else is regenerated on write and ignored
# on read. `id` is the key matching file to node and is never applied.
AUTHORITATIVE_KEYS = ("node", "prompt", "context-file")


def style_for(file_name: str) -> CommentStyle:
    return _STYLES.get(Path(file_name).suffix.lower(), _PYTHON)


def slug(label: str) -> str:
    """
    A file name from a node label, because the point of files is that the file
    tree reads like the graph. Everything a filesystem dislikes becomes an
    underscore; the result is never empty.
    """
    cleaned = re.sub(r"[^\w\-. ]", "", label, flags=re.UNICODE).strip()
    cleaned = re.sub(r"[\s.]+", "_", cleaned).strip("_")
    return cleaned or "node"


def default_file_name(label: str, extension: str, taken: Optional[set] = None) -> str:
    """
    `Analyse` + `.py` -> `Analyse.py`, made unique against *taken*.

    Two nodes may carry the same label -- nothing stops that -- so a numeric
    suffix is the price of keeping the name readable rather than hashing an id
    into it.
    """
    base = slug(label)
    candidate = f"{base}{extension}"
    taken = taken or set()
    index = 2
    while candidate.lower() in {t.lower() for t in taken}:
        candidate = f"{base}_{index}{extension}"
        index += 1
    return candidate


# ---------------------------------------------------------------------------
# One view of "a thing with a name and some text somebody wrote"
# ---------------------------------------------------------------------------

@dataclass
class Authored:
    """
    A node or a widget, seen through its `AuthoredFile`.

    They are the same object at two levels -- a widget is an element that
    happens to live inside a gui node -- and roughly everything about putting
    one in a file is identical: the name, the header, which keys flow back, the
    conflict check. So the difference is captured once, here, and every function
    below takes an `Authored` and never learns which of the two it holds.
    """

    label: str
    ident: str
    spec: Any                 # AuthoredFile
    body_holder: Any          # node.config, or the widget itself
    prompt_holder: Any        # node, node.config, or the widget itself
    pointer_holder: Any       # where `code_file` lives
    context_file: str = ""
    inputs: Tuple[str, ...] = ()
    outputs: Tuple[str, ...] = ()

    @property
    def body(self) -> str:
        return str(getattr(self.body_holder, self.spec.body_field, "") or "")

    @body.setter
    def body(self, value: str) -> None:
        setattr(self.body_holder, self.spec.body_field, value)

    @property
    def prompt(self) -> str:
        if not self.spec.prompt_field:
            return ""
        return str(getattr(self.prompt_holder, self.spec.prompt_field, "") or "")

    @prompt.setter
    def prompt(self, value: str) -> None:
        if self.spec.prompt_field:
            setattr(self.prompt_holder, self.spec.prompt_field, value)

    @property
    def file_name(self) -> str:
        return str(getattr(self.pointer_holder, "code_file", "") or "").strip()

    @file_name.setter
    def file_name(self, value: str) -> None:
        self.pointer_holder.code_file = value


def for_node(node, spec) -> Authored:
    return Authored(
        label=node.label, ident=node.id, spec=spec,
        body_holder=node.config,
        prompt_holder=node if spec.prompt_on_node else node.config,
        pointer_holder=node.config,
        context_file=str(getattr(node.config, "example_file", "") or ""),
        inputs=tuple(p.id for p in node.inputs),
        outputs=tuple(p.id for p in node.outputs),
    )


def for_widget(widget, spec) -> Authored:
    return Authored(
        label=widget.label or widget.id, ident=widget.id, spec=spec,
        body_holder=widget, prompt_holder=widget, pointer_holder=widget,
        context_file=str(getattr(widget, "example_file", "") or ""),
        # A widget's ports are named by convention and are what the surrounding
        # graph wires to, so they are worth stating in the header.
        inputs=(f"{widget.id}_in",), outputs=(f"{widget.id}_out",),
    )


# ---------------------------------------------------------------------------
# Render / parse
# ---------------------------------------------------------------------------

def _header_lines(item: Authored, style: CommentStyle) -> List[str]:
    lines = [style.opening, f"{style.prefix}node:    {item.label}", f"{style.prefix}id:      {item.ident}"]

    if item.prompt.strip():
        lines.append(f"{style.prefix}prompt: |")
        lines.extend(f"{style.prefix}  {line}" for line in item.prompt.strip().splitlines())

    if item.context_file.strip():
        lines.append(f"{style.prefix}context-file: {item.context_file.strip()}")

    # Informational: regenerated every write, never read back.
    if item.inputs:
        lines.append(f"{style.prefix}inputs:  {', '.join(item.inputs)}")
    if item.outputs:
        lines.append(f"{style.prefix}outputs: {', '.join(item.outputs)}")
    lines.append(style.closing)
    return lines


def _is_opening(line: str, style: CommentStyle) -> bool:
    """Recognise the fence by shape, not by an exact character count.

    These files are meant to be edited by hand, and a person retyping the rule
    with a different number of dashes must not silently turn the whole header
    into body."""
    text = line.strip()
    if not style.prefix:
        return text == "---"
    return text.startswith(style.prefix.strip()) and BANNER in text


def _is_closing(line: str, style: CommentStyle) -> bool:
    text = line.strip()
    if not style.prefix:
        return text == "---"
    if not text.startswith(style.prefix.strip()):
        return False
    rest = text[len(style.prefix.strip()):].strip()
    return bool(rest) and set(rest) == {"-"}


def render(item: Authored, file_name: str) -> str:
    """The full file: header, blank line, then the authored text.

    An element that authors *code* and has none yet gets the skeleton instead of
    an empty file -- the signature it has to fill in, with one line per port. An
    empty .py told a reader nothing that the header had not already said.

    The skeleton is written, never read back: `parse` returns whatever the body
    is, and if the user leaves the stub untouched it is simply a function that
    returns placeholders. Ports stay derived from the wiring, exactly as the
    `inputs:`/`outputs:` header lines are.
    """
    style = style_for(file_name)
    body = item.body.rstrip("\n")
    if not body.strip():
        extension = Path(file_name).suffix.lower()
        if extension in (".py", ".js"):
            body = skeleton.render(
                "javascript" if extension == ".js" else "python",
                item.inputs, item.outputs,
            ).rstrip("\n")
    return "\n".join(_header_lines(item, style)) + "\n\n" + body + "\n"


def apply(item: Authored, header: Dict[str, Any], body: str) -> None:
    """
    Write a parsed file back -- authored fields only.

    `id` is the key that matched this file to this element and is never applied;
    ports are derived from the wiring, so a header that disagrees with them is
    stale text, not an instruction.
    """
    item.body = body
    if header.get("node"):
        item.label = header["node"]
    if "prompt" in header:
        item.prompt = header["prompt"]
    if "context-file" in header:
        item.context_file = header["context-file"]
        # `example_file` is the same field name on a node's config and on a
        # widget, so this is one assignment rather than a branch per level.
        if hasattr(item.body_holder, "example_file"):
            item.body_holder.example_file = header["context-file"]


def parse(text: str, file_name: str = "node.py") -> Tuple[Dict[str, Any], str]:
    """
    Split a node file into `(header, body)`.

    A file with no recognisable header is not an error: it is a file somebody
    wrote by hand, and its whole content is the body. Being lenient here is what
    lets the format be edited by a person rather than only by this module.
    """
    style = style_for(file_name)
    lines = text.splitlines()
    if not lines or not _is_opening(lines[0], style):
        return {}, text.strip("\n")

    header: Dict[str, Any] = {}
    block_key: Optional[str] = None
    block: List[str] = []
    end = len(lines)

    for index, raw in enumerate(lines[1:], start=1):
        if _is_closing(raw, style):
            end = index + 1
            break
        if style.prefix and not raw.strip().startswith(style.prefix.strip()):
            end = index
            break

        # Strip the comment marker but KEEP the indentation after it: two
        # spaces is what marks a `prompt: |` continuation line, and a plain
        # `.strip()` here silently swallowed every multi-line prompt in a
        # markdown file, where there is no marker to strip in the first place.
        content = raw.rstrip()
        if style.prefix:
            content = content.lstrip()[len(style.prefix.strip()):]
            content = content[1:] if content.startswith(" ") else content

        if block_key is not None and (content.startswith("  ") or not content.strip()):
            block.append(content[2:] if content.startswith("  ") else "")
            continue
        if block_key is not None:
            header[block_key] = "\n".join(block).strip("\n")
            block_key, block = None, []

        match = re.match(r"\s*([\w-]+):\s*(.*)$", content)
        if not match:
            continue
        key, value = match.group(1).strip(), match.group(2).strip()
        if value == "|":
            block_key, block = key, []
        else:
            header[key] = value

    if block_key is not None:
        header[block_key] = "\n".join(block).strip("\n")

    return header, "\n".join(lines[end:]).strip("\n")



def node_dir(graph_path: str) -> Path:
    """`my_graph.json` -> `my_graph.nodes/`, beside it."""
    path = Path(graph_path)
    return path.parent / f"{path.stem}.nodes"


# ---------------------------------------------------------------------------
# "Changed on disk since we last looked"
# ---------------------------------------------------------------------------
#
# Two editors now write the same files: this app on save, and whatever the user
# has the folder open in. Without a check, whoever saves last wins and the other
# one's work is gone with no message -- which is the single worst thing a sync
# mechanism can do. So every read and write records what the file looked like,
# and a write refuses when the file no longer matches.
#
# In-memory and per-process, deliberately: this is a local tool, and a
# stat-based guard that forgets on restart is honest about what it can promise.

_seen: Dict[str, Tuple[float, int]] = {}


def _stat(path: Path) -> Optional[Tuple[float, int]]:
    try:
        info = path.stat()
    except OSError:
        return None
    return (info.st_mtime, info.st_size)


def remember(path: Path) -> None:
    """Record a file as we have just seen it."""
    signature = _stat(path)
    if signature is not None:
        _seen[str(path)] = signature


def changed_since_seen(path: Path) -> bool:
    """Whether *path* differs from the last time this process read or wrote it.

    A file we have never seen counts as unchanged: it is new, not conflicted.
    """
    known = _seen.get(str(path))
    if known is None:
        return False
    current = _stat(path)
    return current is not None and current != known


def forget_all() -> None:
    """For tests."""
    _seen.clear()
