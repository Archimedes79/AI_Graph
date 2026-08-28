"""The `image_view` GUI widget element: display-only, shows a picture."""

from __future__ import annotations

import logging
import mimetypes
from typing import Any, Dict, List, Tuple

from app.elements.base import GuiWidgetElement
from app.models.graph import DataType, GuiWidget, GuiWidgetKind, Port, PortKind
from app.services import file_service

logger = logging.getLogger(__name__)

# Above this, a picture is not something to inline into an execution result --
# the value travels as JSON to the browser and would bloat the whole response.
MAX_INLINE_BYTES = 8 * 1024 * 1024

_EXTENSION_FALLBACK = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
}


def to_data_url(path: str) -> str:
    """
    Read an image file and return it as a `data:` URL.

    A picture is delivered inline rather than as a path the browser fetches
    later, for the same reason the file picker browses server-side: the engine's
    filesystem is not the browser's. Inlining also means the deployed runtime
    needs no extra endpoint -- the value simply arrives with the run's result.
    """
    resolved = file_service.resolve_path(path)
    size = file_service.file_size(resolved)
    if size > MAX_INLINE_BYTES:
        raise ValueError(
            f"Image is {size / 1024 / 1024:.1f} MB; the display limit is "
            f"{MAX_INLINE_BYTES // 1024 // 1024} MB."
        )
    mime = mimetypes.guess_type(resolved)[0]
    if not mime or not mime.startswith("image/"):
        suffix = resolved[resolved.rfind("."):].lower() if "." in resolved else ""
        mime = _EXTENSION_FALLBACK.get(suffix, "")
    if not mime:
        raise ValueError(f"Not a recognised image file: {resolved}")
    # read_file already returns base64 for mode="binary" -- one authored copy.
    return f'data:{mime};base64,{file_service.read_file(resolved, "binary")}'


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
            return to_data_url(value)
        except Exception as exc:  # noqa: BLE001 - shown, not raised
            logger.warning("image_view %s could not load %r: %s", widget.id, value, exc)
            return f"⚠ {exc}"
