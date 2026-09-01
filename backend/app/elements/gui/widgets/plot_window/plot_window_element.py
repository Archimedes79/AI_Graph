"""The `plot_window` GUI widget element: display-only, no output port."""

from __future__ import annotations

from app.elements.base import DisplayWidget, Generation
from app.models.graph import GuiWidgetKind


class PlotWindowElement(DisplayWidget):
    """Ports, execute and authored_file are the display-widget contract; what
    is left is the one thing that makes this a chart rather than a picture."""

    widget_kind = GuiWidgetKind.PLOT_WINDOW
    config_fields = ("code", "code_prompt")

    def generation(self) -> Generation:
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
