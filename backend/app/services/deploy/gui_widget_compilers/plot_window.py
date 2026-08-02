"""plot_window GUI widget compiler: display-only widget with no output port."""

from __future__ import annotations

from typing import List

from app.models.graph import GraphNode, GuiWidget


def compile(node: GraphNode, widget: GuiWidget) -> List[str]:
    # Optionally transform the raw incoming value in place; there is no output
    # port to carry it, so display-only widgets write back into `_inputs`.
    in_id = f"{widget.id}_in"
    lines = [f"_raw = _inputs.get({in_id!r})"]
    if widget.code:
        lines.append(
            f"_inputs[{in_id!r}] = (await _run_code({widget.code!r}, {(widget.language or 'python')!r}, "
            "{'value': _raw})).get('value', _raw)"
        )
    return lines
