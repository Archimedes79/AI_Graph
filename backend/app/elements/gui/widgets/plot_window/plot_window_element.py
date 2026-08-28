"""The `plot_window` GUI widget element: display-only, no output port."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.elements.base import AuthoredFile, GuiWidgetElement
from app.models.graph import DataType, GuiWidget, GuiWidgetKind, Port, PortKind


class PlotWindowElement(GuiWidgetElement):
    widget_kind = GuiWidgetKind.PLOT_WINDOW

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        in_id = f"{widget.id}_in"
        label = widget.label or widget.id
        return [Port(id=in_id, name=label, kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)], []

    async def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
        # Display-only: this is never called (see gui/element.py) since a widget
        # with no output port has its in-place transform handled by the caller.
        return None

    def authored_file(self, widget: GuiWidget) -> AuthoredFile:
        """The data transform that turns incoming data into plot-ready points."""
        language = str(getattr(widget, "language", "python") or "python").lower()
        extension = ".js" if language.startswith(("js", "javascript", "node")) else ".py"
        return AuthoredFile(body_field="code", prompt_field="plot_prompt", extension=extension)
