"""The `ai` node element: run inputs through a configured LLM completion call."""

from __future__ import annotations

from typing import Optional

from app.elements.base import AuthoredFile, Generation, NodeElement
from app.models.graph import GraphNode, NodeType
from app.services import file_service

_FORMAT_LABELS = {
    "json": "a JSON object or array",
    "csv": "CSV with a header row",
    "csv_list": "CSV rows as a list of lists",
}




def _as_image_url(value) -> Optional[str]:
    """
    *value* as something a vision model can be sent, or None if it is not an
    image at all -- in which case it stays ordinary prompt text.
    """
    if not isinstance(value, str):
        return None
    if value.startswith("data:image/"):
        return value
    if file_service.is_image_path(value):
        try:
            return file_service.image_data_url(value)
        except (OSError, ValueError):
            return None
    return None


class AIElement(NodeElement):
    node_type = NodeType.AI
    config_fields = (
        "system_prompt", "ai_provider", "ai_model", "temperature", "send_images",
        "output_format", "output_format_prompt",
        "batch_mode", "batch_concurrency", "read_file_inputs",
    )


    def generation(self) -> Generation:
        """The system prompt, written from the node's own description -- the one
        element whose request lives on the node rather than in its config."""
        return Generation(
            kind="prompt", prompt_field="description", target_field="system_prompt",
            prompt_on_node=True,
            guard="Please add a description first.",
            success="✅ Prompt generated!",
        )

    def authored_file(self, node: GraphNode) -> AuthoredFile:
        """The system prompt -- the thing actually written for an ai node.

        Markdown, not a script that calls the model: such a script would be a
        second implementation of what ai_service already does, and would drift
        from it the moment either changed.
        """
        return AuthoredFile(
            body_field="system_prompt", prompt_field="description",
            extension=".md", prompt_on_node=True,
        )
