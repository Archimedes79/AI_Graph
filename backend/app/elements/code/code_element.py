"""The `code` node element: run user/AI-written Python or JavaScript against its inputs.

Reference implementation for AGENTS.md's element contract -- every other
NodeElement should look structurally identical to this one.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.elements.base import AuthoredFile, Generation, NodeElement, code_extension
from app.models.graph import GraphNode, NodeType
from app.services import code_executor
from app.services.batching import reconcile_outputs


class CodeElement(NodeElement):
    node_type = NodeType.CODE

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        cfg = node.config
        result = await code_executor.execute_code(cfg.code, cfg.language, inputs, cfg.requirements)
        return reconcile_outputs(node, result)

    def authored_file(self, node: GraphNode) -> AuthoredFile:
        """The code itself, in a real .py/.js so an editor can help with it."""
        return AuthoredFile(body_field="code", prompt_field="code_prompt",
                            extension=code_extension(node.config))

    def generation(self, node: GraphNode) -> Generation:
        """Generated against the node's own ports -- `inputs`/`outputs` are left
        unset, which means "whatever this node is actually wired as"."""
        return Generation(
            kind="code", prompt_field="code_prompt", target_field="code",
            guard="Please add a code generation prompt first.",
            success="✅ Code generated!",
        )
