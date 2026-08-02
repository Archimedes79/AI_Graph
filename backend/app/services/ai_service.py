"""
AI service – wraps Ollama (default), OpenAI, and Anthropic calls.
All providers expose a common `complete(prompt, system, model, temperature)` interface.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

import httpx

from app.models.graph import AIProvider

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LMSTUDIO_BASE_URL = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")
OPENAI_COMPATIBLE_BASE_URL = os.getenv("OPENAI_COMPATIBLE_BASE_URL", "")
OPENAI_COMPATIBLE_API_KEY = os.getenv("OPENAI_COMPATIBLE_API_KEY", "")


# ---------------------------------------------------------------------------
# Provider helpers
# ---------------------------------------------------------------------------

async def _ollama_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = 120.0,
) -> str:
    payload = {
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {"temperature": temperature},
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
        response.raise_for_status()
        data = response.json()
        return data.get("response", "")


async def _openai_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = 120.0,
) -> str:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY environment variable not set")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model, "messages": messages, "temperature": temperature}
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _anthropic_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = 120.0,
) -> str:
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY environment variable not set")
    payload = {
        "model": model,
        "max_tokens": 4096,
        "temperature": temperature,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        payload["system"] = system
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        return data["content"][0]["text"]


async def _lmstudio_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = 120.0,
) -> str:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model, "messages": messages, "temperature": temperature}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{LMSTUDIO_BASE_URL}/chat/completions",
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _openai_compatible_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = 120.0,
) -> str:
    if not OPENAI_COMPATIBLE_BASE_URL:
        raise ValueError("OPENAI_COMPATIBLE_BASE_URL environment variable not set")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model, "messages": messages, "temperature": temperature}
    headers = {}
    if OPENAI_COMPATIBLE_API_KEY:
        headers["Authorization"] = f"Bearer {OPENAI_COMPATIBLE_API_KEY}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{OPENAI_COMPATIBLE_BASE_URL.rstrip('/')}/chat/completions",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

async def complete(
    prompt: str,
    system: str = "",
    model: str = "llama3",
    temperature: float = 0.7,
    provider: AIProvider = AIProvider.OLLAMA,
) -> str:
    """Call the requested AI provider and return the text completion."""
    logger.info("AI complete: provider=%s model=%s", provider, model)
    if provider == AIProvider.OLLAMA:
        return await _ollama_complete(prompt, system, model, temperature)
    if provider == AIProvider.OPENAI:
        return await _openai_complete(prompt, system, model, temperature)
    if provider == AIProvider.OPENAI_COMPATIBLE:
        return await _openai_compatible_complete(prompt, system, model, temperature)
    if provider == AIProvider.ANTHROPIC:
        return await _anthropic_complete(prompt, system, model, temperature)
    if provider == AIProvider.LMSTUDIO:
        return await _lmstudio_complete(prompt, system, model, temperature)
    raise ValueError(f"Unknown AI provider: {provider}")


async def generate_code(
    description: str,
    language: str = "python",
    context: str = "",
    inputs: list[str] | None = None,
    outputs: list[str] | None = None,
    model: str = "llama3",
    provider: AIProvider = AIProvider.OLLAMA,
) -> tuple[str, str]:
    """
    Ask the LLM to generate code that maps *inputs* to *outputs*.
    Returns (code, explanation).
    """
    inputs = inputs or []
    outputs = outputs or []
    system = (
        "You are an expert software engineer. "
        "When asked to generate code, output ONLY valid code inside a markdown "
        "code block, followed by a brief explanation outside the block. "
        "Do not add extra prose before the code block. "
        "The returned dict's keys must exactly match the requested output names - "
        "downstream nodes look up values by these exact keys."
    )
    prompt_parts = [
        f"Write a {language} function that does the following:",
        description,
    ]
    if context:
        prompt_parts.append(f"\nContext:\n{context}")
    if inputs:
        prompt_parts.append(f"\nInputs: {', '.join(inputs)}")
    if outputs:
        prompt_parts.append(f"\nOutputs: {', '.join(outputs)}")
        prompt_parts.append(
            f"\nYour function must return a dict whose keys are exactly: {outputs!r}. "
            "Use these exact strings as the dict keys - do not rename, abbreviate, "
            "reorder, or invent additional keys, and include every one of them."
        )
    prompt_parts.append(
        "\nThe function must be named `run` and accept a dict named `inputs` "
        "and return a dict named `outputs`. "
        f"Use only the {language} standard library unless the description requires otherwise."
    )
    raw = await complete("\n".join(prompt_parts), system, model, 0.2, provider)

    # Extract code block
    code = _extract_code_block(raw)
    explanation = raw.replace(f"```{language}", "").replace("```", "").strip()
    if code:
        explanation = raw[raw.rfind("```") + 3 :].strip()
    return code or raw, explanation


async def generate_prompt(
    description: str,
    context: str = "",
    model: str = "llama3",
    provider: AIProvider = AIProvider.OLLAMA,
) -> tuple[str, str]:
    """
    Ask the LLM to generate a system prompt from a natural-language description.
    Returns (system_prompt, explanation).
    """
    system = (
        "You are an expert prompt engineer. "
        "Given a natural language description of a task, generate a concise, "
        "effective system prompt for an AI assistant. "
        "Output the system prompt as plain text inside <system_prompt> tags, "
        "then a brief explanation."
    )
    prompt = f"Task description: {description}"
    if context:
        prompt += f"\n\nAdditional context: {context}"
    raw = await complete(prompt, system, model, 0.3, provider)

    # Extract <system_prompt>...</system_prompt>
    import re
    match = re.search(r"<system_prompt>(.*?)</system_prompt>", raw, re.DOTALL)
    if match:
        sp = match.group(1).strip()
        explanation = raw[match.end() :].strip()
    else:
        sp = raw.strip()
        explanation = ""
    return sp, explanation


async def generate_graph(
    description: str,
    context: str = "",
    model: str = "llama3",
    provider: AIProvider = AIProvider.OLLAMA,
) -> tuple[dict, str]:
    """
    Ask the LLM to author a full Graph DSL document from a natural-language
    description. Returns (graph_dict, explanation). The caller is responsible
    for validating graph_dict against the Graph pydantic model.
    """
    system = (
        "You are an expert at authoring Graph DSL documents for a visual node-based "
        "AI workflow tool. When asked to design a graph, output ONLY a fenced ```json "
        "code block containing a complete Graph DSL document, followed by a brief "
        "explanation outside the block. Do not add extra prose before the code block.\n\n"
        "The JSON document must have this exact shape:\n"
        "{\n"
        '  "metadata": {"name": str, "version": str, "description": str, "author": str, "tags": [str, ...]},\n'
        '  "nodes": [\n'
        "    {\n"
        '      "id": str, "node_type": str, "label": str, "description": str,\n'
        '      "position": {"x": number, "y": number},\n'
        '      "inputs": [{"id": str, "name": str, "kind": "input", "data_type": str, "multi": bool, "required": bool}, ...],\n'
        '      "outputs": [{"id": str, "name": str, "kind": "output", "data_type": str, "multi": bool, "required": bool}, ...],\n'
        '      "config": {...}\n'
        "    }, ...\n"
        "  ],\n"
        '  "edges": [{"id": str, "source_node_id": str, "source_port_id": str, "target_node_id": str, "target_port_id": str}, ...]\n'
        "}\n\n"
        "Valid node_type values: text_input, file_input, directory_input, ai, code, output, "
        "text_output, merge, split, gui. "
        "Every node must declare its own inputs and outputs port arrays, even if empty, and "
        "every port id must be unique within its node. Edges must reference existing node ids "
        "and port ids declared on those nodes."
    )
    prompt_parts = [
        "Design a graph that does the following:",
        description,
    ]
    if context:
        prompt_parts.append(f"\nContext:\n{context}")
    raw = await complete("\n".join(prompt_parts), system, model, 0.2, provider)

    graph_dict = _extract_json_block(raw)
    if graph_dict is None:
        raise ValueError("Could not parse a Graph DSL JSON document from the AI response")

    import re
    match = re.search(r"```json\n(.*?)```", raw, re.DOTALL)
    explanation = raw[match.end() :].strip() if match else ""
    return graph_dict, explanation


def _extract_code_block(text: str) -> str:
    """Extract the first fenced code block from markdown text."""
    import re
    match = re.search(r"```(?:\w+)?\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return ""


def _extract_json_block(text: str) -> Optional[dict]:
    """
    Extract a fenced ```json code block and parse it as JSON. Falls back to
    parsing the whole raw response as JSON if no fenced block is found.
    Returns None if neither succeeds.
    """
    import re
    match = re.search(r"```json\n(.*?)```", text, re.DOTALL)
    candidate = match.group(1).strip() if match else text.strip()
    try:
        return json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        return None
