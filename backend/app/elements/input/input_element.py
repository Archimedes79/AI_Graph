"""The unified input element: text | file | directory, via config.input_mode."""

from __future__ import annotations

from typing import Optional

from app.elements.base import (AuthoredFile, Generation, NodeElement,
                               SELECTOR_GENERATION)
from app.models.graph import GraphNode, NodeType


def _effective_mode(node: GraphNode) -> str:
    return node.config.input_mode or "text"


class InputElement(NodeElement):
    node_type = NodeType.INPUT
    config_fields = (
        "value", "prompt_at_runtime", "input_mode",
        # Directory mode. Same names the input_picker widget uses, because it is
        # the same contract at two levels (see SELECTOR_GENERATION).
        "recursive", "extensions", "select_all_files",
        "selector_prompt", "selector_code",
    )

    def generation(self) -> Generation:
        """The shared selector contract -- literally the same object the
        `input_picker` widget returns, because it is the same behaviour at two
        levels of the object hierarchy. The editor offers it in directory mode
        only; a text or single-file input selects nothing."""
        return SELECTOR_GENERATION

    def authored_file(self, node: GraphNode) -> Optional[AuthoredFile]:
        """In directory mode the selector is real code, so it gets a real file --
        the same one an `input_picker` widget gets. A text or single-file input
        authors nothing and returns None, as before."""
        if _effective_mode(node) != "directory":
            return None
        return AuthoredFile(body_field="selector_code", prompt_field="selector_prompt",
                            extension='.js')
