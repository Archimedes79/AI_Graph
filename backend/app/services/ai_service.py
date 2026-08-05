"""
AI service – wraps Ollama (default), OpenAI, and Anthropic calls.
All providers expose a common `complete(prompt, system, model, temperature)` interface.
"""

from __future__ import annotations

import json
import logging
import os
import time
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
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_MODELS_BASE_URL = os.getenv("GITHUB_MODELS_BASE_URL", "https://models.github.ai/inference")

# Local models (ollama/lmstudio) on modest hardware routinely take several
# minutes -- up to ~10 minutes -- for a large generation prompt with
# context-file content; keep an env override but default well above that.
# Since every provider call now streams (see below), this mainly bounds the
# connect/write/pool phases -- the per-chunk read budget is AI_STREAM_IDLE_TIMEOUT.
AI_COMPLETE_TIMEOUT = float(os.getenv("AI_COMPLETE_TIMEOUT", "660"))

# Bounds worst-case latency for "reasoning"/"thinking" local models, which can
# spend thousands of tokens of internal chain-of-thought (billed as normal
# output tokens) before ever emitting a real answer -- without this cap such a
# model can burn the entire AI_COMPLETE_TIMEOUT and get killed by our client
# mid-thought, never returning any content at all.
AI_MAX_TOKENS = int(os.getenv("AI_MAX_TOKENS", "4096"))

# Streaming turns the timeout into a per-chunk *idle* timeout: it resets on
# every token received, so a model that is slow but still actively producing
# tokens is never mistaken for a hung one -- only a connection that goes
# completely silent for this long is treated as failed.
AI_STREAM_IDLE_TIMEOUT = float(os.getenv("AI_STREAM_IDLE_TIMEOUT", "120"))

# How often (seconds) to log accumulated progress while a stream is in
# flight, so a slow local model's output can be watched growing in the
# console instead of just waiting for the final result.
_STREAM_PROGRESS_LOG_INTERVAL = 5.0


def _stream_timeout(connect_write_pool_budget: float) -> httpx.Timeout:
    return httpx.Timeout(connect_write_pool_budget, read=AI_STREAM_IDLE_TIMEOUT)


async def _stream_chat_completion(
    client: httpx.AsyncClient,
    url: str,
    payload: dict,
    headers: dict,
    provider: str,
    model: str,
) -> str:
    """
    POST an OpenAI-style `stream: true` chat-completions request and
    accumulate the streamed `delta.content` chunks into the full text.
    Shared by every provider using this SSE schema (openai, openai_compatible,
    lmstudio, github_copilot).
    """
    chunks: list[str] = []
    start = time.monotonic()
    last_logged = start
    async with client.stream("POST", url, json={**payload, "stream": True}, headers=headers) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if data == "[DONE]":
                break
            try:
                event = json.loads(data)
            except json.JSONDecodeError:
                continue
            piece = event.get("choices", [{}])[0].get("delta", {}).get("content") or ""
            if not piece:
                continue
            chunks.append(piece)
            now = time.monotonic()
            if now - last_logged >= _STREAM_PROGRESS_LOG_INTERVAL:
                logger.info(
                    "AI stream progress <- provider=%s model=%s after %.1fs (%d chars so far)",
                    provider, model, now - start, sum(len(c) for c in chunks),
                )
                last_logged = now
    return "".join(chunks)


# ---------------------------------------------------------------------------
# Provider helpers
# ---------------------------------------------------------------------------

async def _ollama_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    payload = {
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": True,
        "options": {"temperature": temperature, "num_predict": AI_MAX_TOKENS},
    }
    chunks: list[str] = []
    start = time.monotonic()
    last_logged = start
    async with httpx.AsyncClient(timeout=_stream_timeout(timeout)) as client:
        async with client.stream("POST", f"{OLLAMA_BASE_URL}/api/generate", json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                piece = event.get("response") or ""
                if piece:
                    chunks.append(piece)
                    now = time.monotonic()
                    if now - last_logged >= _STREAM_PROGRESS_LOG_INTERVAL:
                        logger.info(
                            "AI stream progress <- provider=ollama model=%s after %.1fs (%d chars so far)",
                            model, now - start, sum(len(c) for c in chunks),
                        )
                        last_logged = now
                if event.get("done"):
                    break
    return "".join(chunks)


async def _openai_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY environment variable not set")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": AI_MAX_TOKENS}
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    async with httpx.AsyncClient(timeout=_stream_timeout(timeout)) as client:
        return await _stream_chat_completion(
            client, "https://api.openai.com/v1/chat/completions", payload, headers, "openai", model,
        )


async def _anthropic_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY environment variable not set")
    payload = {
        "model": model,
        "max_tokens": AI_MAX_TOKENS,
        "temperature": temperature,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        payload["system"] = system
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
    }
    chunks: list[str] = []
    start = time.monotonic()
    last_logged = start
    async with httpx.AsyncClient(timeout=_stream_timeout(timeout)) as client:
        async with client.stream(
            "POST", "https://api.anthropic.com/v1/messages", json={**payload, "stream": True}, headers=headers,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if not data:
                    continue
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "content_block_delta":
                    piece = event.get("delta", {}).get("text") or ""
                    if piece:
                        chunks.append(piece)
                        now = time.monotonic()
                        if now - last_logged >= _STREAM_PROGRESS_LOG_INTERVAL:
                            logger.info(
                                "AI stream progress <- provider=anthropic model=%s after %.1fs (%d chars so far)",
                                model, now - start, sum(len(c) for c in chunks),
                            )
                            last_logged = now
                elif event.get("type") == "message_stop":
                    break
    return "".join(chunks)


async def _lmstudio_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": AI_MAX_TOKENS,
    }
    async with httpx.AsyncClient(timeout=_stream_timeout(timeout)) as client:
        return await _stream_chat_completion(
            client, f"{LMSTUDIO_BASE_URL}/chat/completions", payload, {}, "lmstudio", model,
        )


async def _openai_compatible_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    if not OPENAI_COMPATIBLE_BASE_URL:
        raise ValueError("OPENAI_COMPATIBLE_BASE_URL environment variable not set")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": AI_MAX_TOKENS}
    headers = {}
    if OPENAI_COMPATIBLE_API_KEY:
        headers["Authorization"] = f"Bearer {OPENAI_COMPATIBLE_API_KEY}"
    async with httpx.AsyncClient(timeout=_stream_timeout(timeout)) as client:
        return await _stream_chat_completion(
            client, f"{OPENAI_COMPATIBLE_BASE_URL.rstrip('/')}/chat/completions", payload, headers,
            "openai_compatible", model,
        )


async def _github_copilot_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    if not GITHUB_TOKEN:
        raise ValueError("GITHUB_TOKEN environment variable not set")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": AI_MAX_TOKENS}
    headers = {"Authorization": f"Bearer {GITHUB_TOKEN}"}
    async with httpx.AsyncClient(timeout=_stream_timeout(timeout)) as client:
        return await _stream_chat_completion(
            client, f"{GITHUB_MODELS_BASE_URL.rstrip('/')}/chat/completions", payload, headers,
            "github_copilot", model,
        )


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

async def complete(
    prompt: str,
    system: str = "",
    model: str = "llama3",
    temperature: float = 0.7,
    provider: str = "ollama",
) -> str:
    """
    Call the requested AI provider and return the text completion.

    *provider* is compared against plain provider-name strings (not the
    `AIProvider` enum) so this function's body has no app-internal-model
    dependency and can be embedded verbatim in the deploy bundle (see
    deploy_service.py's `extract_source`); `AIProvider` is a `str` subclass, so
    passing an enum member here still compares equal.
    """
    start = time.monotonic()
    # Logged at INFO so a hanging/slow local model (lmstudio/ollama) can be
    # diagnosed from the backend console: exactly what was sent, and how long
    # the provider actually took (or whether/when it ever came back).
    logger.info(
        "AI request -> provider=%s model=%s temperature=%s\n--- system ---\n%s\n--- prompt ---\n%s",
        provider, model, temperature, system, prompt,
    )
    try:
        if provider == "ollama":
            result = await _ollama_complete(prompt, system, model, temperature)
        elif provider == "openai":
            result = await _openai_complete(prompt, system, model, temperature)
        elif provider == "openai_compatible":
            result = await _openai_compatible_complete(prompt, system, model, temperature)
        elif provider == "anthropic":
            result = await _anthropic_complete(prompt, system, model, temperature)
        elif provider == "lmstudio":
            result = await _lmstudio_complete(prompt, system, model, temperature)
        elif provider == "github_copilot":
            result = await _github_copilot_complete(prompt, system, model, temperature)
        else:
            raise ValueError(f"Unknown AI provider: {provider}")
    except Exception:
        logger.exception(
            "AI request FAILED <- provider=%s model=%s after %.1fs",
            provider, model, time.monotonic() - start,
        )
        raise
    logger.info(
        "AI response <- provider=%s model=%s after %.1fs (%d chars)\n--- response ---\n%s",
        provider, model, time.monotonic() - start, len(result), result,
    )
    return result


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


async def generate_output_format(
    description: str,
    context: str = "",
    model: str = "llama3",
    provider: AIProvider = AIProvider.OLLAMA,
) -> tuple[str, str]:
    """
    Ask the LLM to describe the expected "custom" output format/shape for a
    node from a natural-language description (e.g. field names, types,
    nesting). This text is later injected verbatim into other nodes' AI code/
    prompt generation as context -- see NodeConfig.output_format_prompt and
    NodeEditor.tsx's outputFormatContext(). Returns (format_description, explanation).
    """
    system = (
        "You are an expert at specifying data output formats/shapes for software "
        "functions. Given a natural language description of a task, produce a "
        "concise, unambiguous description of the exact output format/shape the "
        "function should return (field names, types, nesting). This text is "
        "injected into other AI generation prompts verbatim -- it is descriptive, "
        "not executable code. "
        "Output the format description as plain text inside <output_format> tags, "
        "then a brief explanation."
    )
    prompt = f"Task description: {description}"
    if context:
        prompt += f"\n\nAdditional context: {context}"
    raw = await complete(prompt, system, model, 0.3, provider)

    import re
    match = re.search(r"<output_format>(.*?)</output_format>", raw, re.DOTALL)
    if match:
        fmt = match.group(1).strip()
        explanation = raw[match.end() :].strip()
    else:
        fmt = raw.strip()
        explanation = ""
    return fmt, explanation


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
        "Valid node_type values: input, ai, code, output, gui. An \"input\" node's "
        "config.input_mode selects text, file, or directory input. There is no dedicated "
        "merge/split node type: fan-in (multiple edges into one "
        "multi input port) and fan-out (one output wired to many inputs) are pure edge "
        "wiring, and any merge/split-style aggregation (concat/sum/count/json_list a set of "
        "inputs, or splitting text into a list) should be written as a \"code\" node. For a "
        "display-only output, use node_type \"output\" with config.write_mode = \"window\" "
        "(shows the result in a text window). "
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
