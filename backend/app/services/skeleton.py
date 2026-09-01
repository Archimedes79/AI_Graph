"""
The empty body of a code element, rendered as a typed, runnable stub.

A generator used to be told its ports as prose -- `Inputs: text, files` -- with
no type, no shape and no idea where a value came from. That is the least
informative form of the most important fact, and small local models (the ones
this editor is built around) guess badly from it. The same is true for a person:
a code node opened for the first time showed an empty textarea.

So both get the same thing instead: the function signature, with one commented
line per port saying what actually arrives there.

    /**
     * @typedef {Object} Inputs
     * @property {string} text     # from "Reader"
     * @property {string[]} files  # from "Ordner"
     */

    /** @param {Inputs} inputs */
    function run(inputs) {
      return { summary: null };
    }

JSDoc rather than TypeScript: it *is* plain JavaScript at run time, so nothing
has to strip anything before the body runs, and the annotation cannot become a
second contract that disagrees with the ports. Editors still give completion on
`inputs.text`.

**Rendered, never parsed back.** Ports are derived from the wiring; a text file
allowed to rename one would silently detach edges. This is the same rule
`node_files` already applies to the `inputs:`/`outputs:` header lines it writes.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

# How many characters of a sample value to show as an example. Enough to see the
# shape, little enough that a directory listing does not become the skeleton.
_EXAMPLE_LIMIT = 60


def _js_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        inner = _js_type(value[0]) if value else "*"
        return f"{inner}[]"
    if isinstance(value, dict):
        return "Object"
    return "*"


def _note(port: str, sources: Optional[Dict[str, str]], sample: Optional[Dict[str, Any]]) -> str:
    """The trailing comment for one input line: where it comes from, and a peek.

    Provenance first: "from Ordner" is what tells a reader *why* the value looks
    the way it does, and it is the part no type can express.
    """
    parts = []
    origin = (sources or {}).get(port)
    if origin:
        parts.append(f'from "{origin}"')
    if sample is not None and port in sample:
        rendered = repr(sample[port])
        if len(rendered) > _EXAMPLE_LIMIT:
            rendered = rendered[:_EXAMPLE_LIMIT] + "…"
        parts.append(f"e.g. {rendered}")
    return "  # " + ", ".join(parts) if parts else ""


def render(
    inputs: Sequence[str],
    outputs: Sequence[str],
    sample: Optional[Dict[str, Any]] = None,
    sources: Optional[Dict[str, str]] = None,
) -> str:
    """The stub for one element's `run`.

    *sample* is what the ports actually carried on the last run, when there was
    one; *sources* maps a port to the label of the node feeding it. Both are
    optional -- without them this is still the signature, which is still more
    than a comma-separated list of names.
    """
    return _render_javascript(inputs, outputs, sample, sources)


def _render_javascript(
    inputs: Sequence[str],
    outputs: Sequence[str],
    sample: Optional[Dict[str, Any]],
    sources: Optional[Dict[str, str]],
) -> str:
    """The same statement in the shape JavaScript has for it: a JSDoc typedef.

    There is no TypedDict here, and inventing a class would be a second contract
    for the same ports -- so the types are documentation, which is exactly what
    they are in the Python version too.
    """
    lines: List[str] = []
    if inputs:
        lines.append("/**")
        lines.append(" * @typedef {Object} Inputs")
        for port in inputs:
            observed = (sample or {}).get(port)
            kind = _js_type(observed) if sample is not None and port in sample else "*"
            lines.append(f" * @property {{{kind}}} {port}{_note(port, sources, sample)}")
        lines.append(" */")
        lines.append("")
        lines.append("/** @param {Inputs} inputs */")

    lines.append("function run(inputs) {")
    for port in inputs:
        lines.append(f'  const {_identifier(port)} = inputs["{port}"];')
    if inputs:
        lines.append("")
    if outputs:
        body = ", ".join(f'"{port}": null' for port in outputs)
        lines.append(f"  return {{{body}}};")
    else:
        lines.append("  return {};")
    lines.append("}")
    return "\n".join(lines) + "\n"


def _identifier(port: str) -> str:
    """A port id as a local variable name.

    Port ids come from the wiring and may contain characters neither language
    allows in an identifier (a widget's ports are `<widgetId>_in`, and widget ids
    carry dashes).
    """
    cleaned = "".join(char if char.isalnum() or char == "_" else "_" for char in port)
    return f"_{cleaned}" if not cleaned or cleaned[0].isdigit() else cleaned
