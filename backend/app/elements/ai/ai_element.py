"""The `ai` node element: run inputs through a configured LLM completion call."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.elements.base import DeployNeeds, NodeElement
from app.models.graph import GraphNode, NodeType
from app.services import ai_service
from app.services.batching import reconcile_outputs


class AIElement(NodeElement):
    node_type = NodeType.AI

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        cfg = node.config
        prompt_parts = []
        for port_id, val in inputs.items():
            if val is not None:
                prompt_parts.append(str(val) if not isinstance(val, str) else val)
        prompt = "\n\n".join(prompt_parts)
        response = await ai_service.complete(
            prompt=prompt,
            system=cfg.system_prompt,
            model=cfg.ai_model,
            temperature=cfg.temperature,
            provider=cfg.ai_provider,
        )
        return reconcile_outputs(node, {"output": response})

    def deploy_needs(self, node: GraphNode) -> DeployNeeds:
        return DeployNeeds(ai=True, read_file_inputs=node.config.read_file_inputs)
