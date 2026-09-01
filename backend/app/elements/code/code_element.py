"""The `code` node element.

Reference implementation of the element contract -- every other NodeElement
should look structurally identical to this one.
"""

from __future__ import annotations


from app.elements.base import AuthoredFile, Generation, NodeElement
from app.models.graph import GraphNode, NodeType



class CodeElement(NodeElement):
    node_type = NodeType.CODE
    config_fields = (
        "code", "code_prompt",
        # Read by the executor rather than by `execute` here, but they are
        # settings of this node type and appear in its editor.
        "output_format", "output_format_prompt",
        "batch_mode", "batch_concurrency", "read_file_inputs",
    )

    def authored_file(self, node: GraphNode) -> AuthoredFile:
        """The code itself, in a real .py/.js so an editor can help with it."""
        return AuthoredFile(body_field="code", prompt_field="code_prompt",
                            extension='.js')

    def generation(self) -> Generation:
        """Generated against the node's own ports -- `inputs`/`outputs` are left
        unset, which means "whatever this node is actually wired as"."""
        return Generation(
            kind="code", prompt_field="code_prompt", target_field="code",
            guard="Please add a code generation prompt first.",
            success="✅ Code generated!",
        )
