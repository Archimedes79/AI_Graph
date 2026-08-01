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
    headers = {"Authorization": f"******"}
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
        "Do not add extra prose before the code block."
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


def _extract_code_block(text: str) -> str:
    """Extract the first fenced code block from markdown text."""
    import re
    match = re.search(r"```(?:\w+)?\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return ""
