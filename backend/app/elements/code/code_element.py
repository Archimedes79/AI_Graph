"""The `code` node element: run user/AI-written Python or JavaScript against its inputs.

Reference implementation for AGENTS.md's element contract -- every other
NodeElement should look structurally identical to this one.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.elements.base import AuthoredFile, NodeElement
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
        language = str(getattr(node.config, "language", "python") or "python").lower()
        extension = ".js" if language.startswith(("js", "javascript", "node")) else ".py"
        return AuthoredFile(body_field="code", prompt_field="code_prompt", extension=extension)
