"""The `divider` widget: a rule between sections. Holds nothing at all."""

from __future__ import annotations

from app.elements.base import StaticWidget
from app.models.graph import GuiWidgetKind


class DividerElement(StaticWidget):
    widget_kind = GuiWidgetKind.DIVIDER
