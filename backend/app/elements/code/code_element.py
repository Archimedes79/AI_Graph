"""The `code` node element: run user/AI-written Python or JavaScript against its inputs.

Reference implementation for AGENTS.md's element contract -- every other
NodeElement should look structurally identical to this one.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.elements.base import AuthoredFile, Generation, NodeElement, code_extension
from app.models.graph import GraphNode, NodeType

from app.services.batching import reconcile_outputs


class CodeElement(NodeElement):
    node_type = NodeType.CODE
    config_fields = (
        "code", "code_prompt", "language", "requirements",
        # Read by the executor rather than by `execute` here, but they are
        # settings of this node type and appear in its editor.
        "output_format", "output_format_prompt",
        "batch_mode", "batch_concurrency", "read_file_inputs",
    )

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        if not node.config.code.strip():
            # The base passes an empty body through; for this element the body
            # IS the behaviour, so an empty one is a mistake worth naming. It
            # used to reach the sandbox regardless and come back as a NameError
            # out of a subprocess.
            raise RuntimeError("This code node has no code yet.")
        return reconcile_outputs(node, await self.run_snippet(node, inputs))

    def authored_file(self, node: GraphNode) -> AuthoredFile:
        """The code itself, in a real .py/.js so an editor can help with it."""
        return AuthoredFile(body_field="code", prompt_field="code_prompt",
                            extension=code_extension(node.config))

    def generation(self) -> Generation:
        """Generated against the node's own ports -- `inputs`/`outputs` are left
        unset, which means "whatever this node is actually wired as"."""
        return Generation(
            kind="code", prompt_field="code_prompt", target_field="code",
            guard="Please add a code generation prompt first.",
            success="✅ Code generated!",
        )
