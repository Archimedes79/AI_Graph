"""The `image_view` GUI widget element: display-only, shows a picture."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

from app.elements.base import AuthoredFile, Generation, GuiWidgetElement, code_extension
from app.models.graph import DataType, GuiWidget, GuiWidgetKind, Port, PortKind
from app.services import file_service

logger = logging.getLogger(__name__)


class ImageViewElement(GuiWidgetElement):
    widget_kind = GuiWidgetKind.IMAGE_VIEW

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        in_id = f"{widget.id}_in"
        label = widget.label or widget.id
        return (
            [Port(id=in_id, name=label, kind=PortKind.INPUT, data_type=DataType.ANY,
                  multi=True, required=False)],
            [],
        )

    async def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
        # Display-only, like plot_window: the caller applies the in-place
        # transform instead of calling this.
        return None

    async def display_value(self, widget: GuiWidget, value: Any) -> Any:
        """
        Turn whatever arrived on the input port into something the browser can
        render. A path is read and inlined as a `data:` URL; a value that is
        already a data/http URL passes through; a list becomes a list of the
        same, so a directory picker wired straight in shows a contact sheet.

        A failure here is cosmetic, exactly as for a plot transform: the widget
        displays the reason instead of taking the whole node down with it.
        """
        if isinstance(value, list):
            return [await self.display_value(widget, item) for item in value]
        if not isinstance(value, str) or not value.strip():
            return value
        if value.startswith(("data:", "http://", "https://")):
            return value
        try:
            return file_service.image_data_url(value)
        except Exception as exc:  # noqa: BLE001 - shown, not raised
            logger.warning("image_view %s could not load %r: %s", widget.id, value, exc)
            return f"⚠ {exc}"

    def authored_file(self, widget: GuiWidget) -> AuthoredFile:
        """The optional transform that reshapes an incoming value into a path."""
        return AuthoredFile(body_field="code", prompt_field="code_prompt",
                            extension=code_extension(widget))

    def generation(self) -> Generation:
        """Same snippet contract as plot_window, different destination: a path.

        This widget had the `code` field and no way to generate it, purely
        because generation was a switch in a shell rather than a declaration
        here. Declaring it is the whole feature.
        """
        return Generation(
            kind="code", prompt_field="code_prompt", target_field="code",
            contract=(
                'Must expose run(inputs: dict) -> dict, receiving {"value": <raw incoming value>} '
                'and returning {"value": <an image file path, or a list of them>}. The app loads '
                'and displays the picture itself -- do NOT read, decode or draw the image, and do '
                'NOT import third-party libraries: the code runs in a sandbox with only the '
                'standard library available.'
            ),
            inputs=("value",), outputs=("value",),
            guard="Please describe how to get an image path out of the incoming value first.",
            success="✅ Transform generated!",
        )
