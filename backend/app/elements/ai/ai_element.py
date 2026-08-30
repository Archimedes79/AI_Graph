"""The `ai` node element: run inputs through a configured LLM completion call."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import AuthoredFile, DeployNeeds, Generation, NodeElement
from app.models.graph import GraphNode, NodeType
from app.services import ai_service, file_service
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

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        cfg = node.config
        prompt_parts = []
        images: List[str] = []
        for port_id, val in inputs.items():
            if val is None:
                continue
            # With send_images on, an input that IS an image becomes an image in
            # the request instead of a path pasted into the prompt. A list is
            # expanded, so a directory picker wired straight in sends every file.
            if cfg.send_images:
                candidates = val if isinstance(val, list) else [val]
                urls = [url for url in (_as_image_url(c) for c in candidates) if url]
                if urls:
                    images.extend(urls)
                    continue
            prompt_parts.append(str(val) if not isinstance(val, str) else val)
        prompt = "\n\n".join(prompt_parts)
        format_instruction = output_format_instruction(cfg)
        system = f"{cfg.system_prompt}\n\n{format_instruction}" if format_instruction else cfg.system_prompt
        # `images` is passed only when there are any, so a text-only node makes
        # exactly the call it always made -- including for anything stubbing
        # ai_service.complete, and for an older vendored copy in a bundle.
        extra = {"images": images} if images else {}
        response = await ai_service.complete(
            prompt=prompt,
            system=system,
            model=cfg.ai_model,
            temperature=cfg.temperature,
            provider=cfg.ai_provider,
            **extra,
        )
        return reconcile_outputs(node, {"output": response})

    def deploy_needs(self, node: GraphNode) -> DeployNeeds:
        return DeployNeeds(ai=True)

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
