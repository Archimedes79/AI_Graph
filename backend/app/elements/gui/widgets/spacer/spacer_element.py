"""The `spacer` widget: deliberate empty space between sections."""

from __future__ import annotations

from app.elements.base import StaticWidget
from app.models.graph import GuiWidgetKind


class SpacerElement(StaticWidget):
    """Nothing, on purpose.

    The grid gap is uniform, so it cannot say "this section ends here". A
    document does that with vertical space, and this is the block that holds it
    -- LaTeX's `\vspace`, and one of the twenty widgets Node-RED's dashboard
    converged on after a decade.
    """

    widget_kind = GuiWidgetKind.SPACER
