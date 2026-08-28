"""The `plot_window` GUI widget element: display-only, no output port."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.elements.base import AuthoredFile, Generation, GuiWidgetElement, code_extension
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
        return AuthoredFile(body_field="code", prompt_field="code_prompt",
                            extension=code_extension(widget))

    def generation(self, widget: GuiWidget) -> Generation:
        """The transform reshapes data; it must not draw anything.

        Spelling that out matters: without it, models reliably reach for
        matplotlib, which is not installed in the sandbox and whose figures are
        not JSON-serializable anyway. The chart is drawn by the app
        (`PlotWidget.tsx`, a dependency-free SVG renderer).
        """
        return Generation(
            kind="code", prompt_field="code_prompt", target_field="code",
            contract=(
                'Must expose run(inputs: dict) -> dict, receiving {"value": <raw incoming data>} '
                'and returning {"value": <plot-ready data>}. Plot-ready data is a JSON-serializable '
                'list of points: either a list of numbers, or a list of {"label": str, "value": number} '
                'objects. The app renders these itself as an SVG bar/line chart -- do NOT draw anything '
                'and do NOT import plotting or third-party libraries (no matplotlib, plotly, pandas, '
                'numpy): the code runs in a sandbox with only the standard library available.'
            ),
            inputs=("value",), outputs=("value",),
            guard="Please describe the chart transform you need first.",
            success="✅ Transform generated!",
        )
