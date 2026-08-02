"""The `ai` node element: run inputs through a configured LLM completion call."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import DeployNeeds, NodeElement, NodeMap, Sources
from app.models.graph import GraphNode, NodeType
from app.services import ai_service
from app.services.batching import reconcile_outputs
from app.services.deploy.shared import collect_inputs_lines, resolve_file_inputs_lines


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

    def compile(self, node: GraphNode, sources: Sources, node_map: NodeMap) -> List[str]:
        cfg = node.config
        lines: List[str] = []
        lines.extend(collect_inputs_lines(node, sources))
        lines.extend(resolve_file_inputs_lines(node, sources, node_map))
        output_port_ids = [p.id for p in node.outputs]
        multi_port_ids = [p.id for p in node.outputs if p.multi]
        if cfg.batch_mode == "whole_list":
            lines.append(r'_prompt = "\n\n".join(str(_v) for _v in _inputs.values() if _v is not None)')
            lines.append(
                "_output = await complete(_prompt, "
                f"system={cfg.system_prompt!r}, model={cfg.ai_model!r}, "
                f"temperature={cfg.temperature!r}, provider={cfg.ai_provider.value!r})"
            )
            lines.append(f"results[{node.id!r}] = reconcile_outputs_by_ids({output_port_ids!r}, {{'output': _output}})")
        else:
            input_multi_port_ids = [p.id for p in node.inputs if p.multi]
            lines.append(
                f"results[{node.id!r}] = await _ai_complete_batch(_inputs, "
                f"system={cfg.system_prompt!r}, model={cfg.ai_model!r}, "
                f"temperature={cfg.temperature!r}, provider={cfg.ai_provider.value!r}, "
                f"output_port_ids={output_port_ids!r}, multi_port_ids={multi_port_ids!r}, "
                f"input_multi_port_ids={input_multi_port_ids!r})"
            )
        return lines

    def deploy_needs(self, node: GraphNode) -> DeployNeeds:
        return DeployNeeds(ai=True, read_file_inputs=node.config.read_file_inputs)
