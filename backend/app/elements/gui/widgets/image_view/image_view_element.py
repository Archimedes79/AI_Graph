"""The `image_view` GUI widget element: display-only, shows a picture."""

from __future__ import annotations

import logging

from app.elements.base import DisplayWidget, Generation
from app.models.graph import GuiWidgetKind

logger = logging.getLogger(__name__)


class ImageViewElement(DisplayWidget):
    widget_kind = GuiWidgetKind.IMAGE_VIEW
    config_fields = ("code", "code_prompt")

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
