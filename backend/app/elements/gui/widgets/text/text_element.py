"""The `text` widget: prose on the page -- a heading, a paragraph, a caption."""

from __future__ import annotations

from app.elements.base import StaticWidget
from app.models.graph import GuiWidgetKind


class TextElement(StaticWidget):
    """One kind, three roles, chosen with `mode`.

    A heading and a paragraph hold the same thing -- a string -- contribute the
    same ports (none), and are edited in the same field. What differs is size,
    weight and where the text sits in its box, which is formatting, not a
    different element. Splitting them would have been a second widget kind for
    a `<select>`.

    Markdown throughout, because a sentence above a form usually wants one bold
    word or one link, and offering that costs nothing.
    """

    widget_kind = GuiWidgetKind.TEXT
    config_fields = ("value", "mode")
