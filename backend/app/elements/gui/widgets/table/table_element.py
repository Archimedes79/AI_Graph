"""The `table` GUI widget: display-only, shows rows."""

from __future__ import annotations

from app.elements.base import DisplayWidget, Generation
from app.models.graph import GuiWidgetKind


class TableElement(DisplayWidget):
    """Same contract as the other display widgets: one input port, no output,
    and an optional snippet that reshapes whatever arrives into rows."""

    widget_kind = GuiWidgetKind.TABLE
    config_fields = ("code", "code_prompt")

    def generation(self) -> Generation:
        return Generation(
            kind="code", prompt_field="code_prompt", target_field="code",
            contract=(
                'Must expose run(inputs: dict) -> dict, receiving {"value": <raw incoming data>} '
                'and returning {"value": <table-ready rows>}. Table-ready data is a '
                'JSON-serializable list of objects with the same keys (the keys become the '
                'column headers), or a list of lists whose first row is the header. The app '
                'renders the table itself -- do NOT format it as text and do NOT import '
                'third-party libraries: the code runs in a sandbox with only the standard '
                'library available.'
            ),
            inputs=("value",), outputs=("value",),
            guard="Please describe how to turn the incoming data into rows first.",
            success="✅ Transform generated!",
        )
