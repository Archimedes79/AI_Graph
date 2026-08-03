"""The `ai` node element: run inputs through a configured LLM completion call."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.elements.base import DeployNeeds, NodeElement
from app.models.graph import GraphNode, NodeType
from app.services import ai_service
from app.services.batching import reconcile_outputs

_FORMAT_LABELS = {
    "json": "a JSON object or array",
    "csv": "CSV with a header row",
    "csv_list": "CSV rows as a list of lists",
}


def output_format_instruction(cfg) -> str:
    """A one-line instruction derived from config.output_format/output_format_prompt,
    shared by the AI node's runtime prompt and (via NodeEditor.tsx's mirrored logic)
    the AI-assisted code/prompt generation context. Empty for the default 'text' format."""
    fmt = cfg.output_format
    if not fmt or fmt == "text":
        return ""
    if fmt == "custom":
        description = f" ({cfg.output_format_prompt})" if cfg.output_format_prompt else ""
        return f"Respond in the following format{description}."
    return f"Respond with {_FORMAT_LABELS.get(fmt, fmt)}."


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
        format_instruction = output_format_instruction(cfg)
        system = f"{cfg.system_prompt}\n\n{format_instruction}" if format_instruction else cfg.system_prompt
        response = await ai_service.complete(
            prompt=prompt,
            system=system,
            model=cfg.ai_model,
            temperature=cfg.temperature,
            provider=cfg.ai_provider,
        )
        return reconcile_outputs(node, {"output": response})

    def deploy_needs(self, node: GraphNode) -> DeployNeeds:
        return DeployNeeds(ai=True, read_file_inputs=node.config.read_file_inputs)
