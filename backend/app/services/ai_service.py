"""
AI service – wraps Ollama (default), OpenAI, and Anthropic calls.
All providers expose a common `complete(prompt, system, model, temperature)` interface.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Callable, Dict, Optional

import httpx

from app.models.graph import AIProvider
from app.services import ai_settings

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LMSTUDIO_BASE_URL = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")
OPENAI_COMPATIBLE_BASE_URL = os.getenv("OPENAI_COMPATIBLE_BASE_URL", "")
OPENAI_COMPATIBLE_API_KEY = os.getenv("OPENAI_COMPATIBLE_API_KEY", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_MODELS_BASE_URL = os.getenv("GITHUB_MODELS_BASE_URL", "https://models.github.ai/inference")


# Endpoints and credentials are resolved per call rather than read from the
# constants above directly: an explicitly-set environment variable still wins,
# but otherwise `ai-settings.json` supplies them (see ai_settings.py). That is
# what lets a deployed, double-clicked executable be pointed at a local LM
# Studio or a hosted endpoint without setting environment variables at all --
# the constants stay as the env-derived defaults these fall back to.

def _ollama_base_url() -> str:
    return ai_settings.endpoint("OLLAMA_BASE_URL", OLLAMA_BASE_URL, "ollama_base_url")


def _lmstudio_base_url() -> str:
    return ai_settings.endpoint("LMSTUDIO_BASE_URL", LMSTUDIO_BASE_URL, "lmstudio_base_url")


def _openai_compatible_base_url() -> str:
    return ai_settings.endpoint(
        "OPENAI_COMPATIBLE_BASE_URL", OPENAI_COMPATIBLE_BASE_URL, "openai_compatible_base_url"
    )


def _github_models_base_url() -> str:
    return ai_settings.endpoint("GITHUB_MODELS_BASE_URL", GITHUB_MODELS_BASE_URL, "github_models_base_url")


def _openai_api_key() -> str:
    return ai_settings.credential("OPENAI_API_KEY", OPENAI_API_KEY, "openai")


def _anthropic_api_key() -> str:
    return ai_settings.credential("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY, "anthropic")


def _openai_compatible_api_key() -> str:
    return ai_settings.credential(
        "OPENAI_COMPATIBLE_API_KEY", OPENAI_COMPATIBLE_API_KEY, "openai_compatible"
    )


def _github_token() -> str:
    return ai_settings.credential("GITHUB_TOKEN", GITHUB_TOKEN, "github")

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


class _StreamProgress:
    """
    Accumulates a streamed completion and logs how it is growing.

    Every provider streams, but in three different wire formats (OpenAI-style
    SSE, Ollama's newline-delimited JSON, Anthropic's own SSE events), so only
    the buffer and the logging cadence are shared here -- each provider keeps
    its own line parsing.
    """

    def __init__(self, provider: str, model: str) -> None:
        self._chunks: list[str] = []
        self._provider = provider
        self._model = model
        self._start = time.monotonic()
        self._last_logged = self._start

    def add(self, piece: str) -> None:
        if not piece:
            return
        self._chunks.append(piece)
        now = time.monotonic()
        if now - self._last_logged >= _STREAM_PROGRESS_LOG_INTERVAL:
            logger.info(
                "AI stream progress <- provider=%s model=%s after %.1fs (%d chars so far)",
                self._provider, self._model, now - self._start, sum(len(c) for c in self._chunks),
            )
            self._last_logged = now

    def text(self) -> str:
        return "".join(self._chunks)


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
    progress = _StreamProgress(provider, model)
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
            progress.add(event.get("choices", [{}])[0].get("delta", {}).get("content") or "")
    return progress.text()


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
    progress = _StreamProgress("ollama", model)
    async with httpx.AsyncClient(timeout=_stream_timeout(timeout)) as client:
        async with client.stream("POST", f"{_ollama_base_url()}/api/generate", json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                progress.add(event.get("response") or "")
                if event.get("done"):
                    break
    return progress.text()


@dataclass(frozen=True)
class _OpenAIStyle:
    """
    One provider that speaks the OpenAI chat-completions API, described rather
    than coded.

    Four of our providers build the identical messages/payload and stream the
    identical SSE schema; all that genuinely differs is where to POST, which
    credential to send, and whether that credential is mandatory. Holding those
    four facts as data means a fifth such provider is one table entry instead of
    another copy of the same twenty lines -- and that a fix to the request
    shape cannot be applied to three of them and forgotten on the fourth.

    Ollama and Anthropic are deliberately NOT in here: different endpoints,
    different payload keys, different stream framing and termination. Only
    `_StreamProgress` is shared with them.
    """

    base_url: Callable[[], str]
    credential: Optional[Callable[[], str]] = None
    credential_required: bool = False
    missing_credential_error: str = ""
    missing_base_url_error: str = ""


_OPENAI_STYLE: Dict[str, _OpenAIStyle] = {
    "openai": _OpenAIStyle(
        base_url=lambda: "https://api.openai.com/v1",
        credential=_openai_api_key,
        credential_required=True,
        missing_credential_error=(
            "No OpenAI API key configured (OPENAI_API_KEY, or api_keys.openai in ai-settings.json)"
        ),
    ),
    # A local LM Studio needs no credential at all.
    "lmstudio": _OpenAIStyle(base_url=_lmstudio_base_url),
    "openai_compatible": _OpenAIStyle(
        base_url=_openai_compatible_base_url,
        credential=_openai_compatible_api_key,   # optional: many self-hosted endpoints have none
        missing_base_url_error=(
            "No OpenAI-compatible endpoint configured (OPENAI_COMPATIBLE_BASE_URL, "
            "or endpoints.openai_compatible_base_url in ai-settings.json)"
        ),
    ),
    "github_copilot": _OpenAIStyle(
        base_url=_github_models_base_url,
        credential=_github_token,
        credential_required=True,
        missing_credential_error=(
            "No GITHUB_TOKEN configured (env var, or api_keys.github in ai-settings.json)"
        ),
    ),
}


async def _openai_style_complete(
    provider: str,
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    """The one request body every `_OPENAI_STYLE` provider shares."""
    spec = _OPENAI_STYLE[provider]

    base_url = spec.base_url()
    if not base_url:
        raise ValueError(spec.missing_base_url_error or f"No base URL configured for provider {provider!r}")

    headers = {}
    if spec.credential is not None:
        token = spec.credential()
        if not token and spec.credential_required:
            raise ValueError(spec.missing_credential_error)
        if token:
            headers["Authorization"] = f"Bearer {token}"

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": AI_MAX_TOKENS}

    async with httpx.AsyncClient(timeout=_stream_timeout(timeout)) as client:
        return await _stream_chat_completion(
            client, f"{base_url.rstrip('/')}/chat/completions", payload, headers, provider, model,
        )


# The four named wrappers stay: `complete()` dispatches by function name and the
# provider tests monkeypatch these directly, so they are part of the module's
# surface, not incidental.

async def _openai_complete(
    prompt: str, system: str, model: str, temperature: float, timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    return await _openai_style_complete("openai", prompt, system, model, temperature, timeout)


async def _anthropic_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    api_key = _anthropic_api_key()
    if not api_key:
        raise ValueError(
            "No Anthropic API key configured (ANTHROPIC_API_KEY, or api_keys.anthropic in ai-settings.json)"
        )
    payload = {
        "model": model,
        "max_tokens": AI_MAX_TOKENS,
        "temperature": temperature,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        payload["system"] = system
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }
    progress = _StreamProgress("anthropic", model)
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
                    progress.add(event.get("delta", {}).get("text") or "")
                elif event.get("type") == "message_stop":
                    break
    return progress.text()


async def _lmstudio_complete(
    prompt: str, system: str, model: str, temperature: float, timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    return await _openai_style_complete("lmstudio", prompt, system, model, temperature, timeout)


async def _openai_compatible_complete(
    prompt: str, system: str, model: str, temperature: float, timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    return await _openai_style_complete("openai_compatible", prompt, system, model, temperature, timeout)


async def _github_copilot_complete(
    prompt: str, system: str, model: str, temperature: float, timeout: float = AI_COMPLETE_TIMEOUT,
) -> str:
    return await _openai_style_complete("github_copilot", prompt, system, model, temperature, timeout)


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

async def complete(
    prompt: str,
    system: str = "",
    model: str = "",
    temperature: float = 0.7,
    provider: str = ai_settings.DEFAULT_SENTINEL,
) -> str:
    """
    Call the requested AI provider and return the text completion.

    *provider* may be the `default` sentinel (the default for new AI nodes),
    meaning "whatever this run is configured to use" -- it is resolved here,
    once, through `ai_settings.resolve_target`, so no caller and no element has
    to know where the runtime AI configuration comes from. A node that names a
    real provider keeps it unless the run forces one.

    After resolution, *provider* is compared against plain provider-name
    strings (not the `AIProvider` enum) so this function's body has no
    app-internal-model dependency and can be embedded verbatim in the deploy
    bundle; `AIProvider` is a `str` subclass, so passing an enum member here
    still compares equal.
    """
    # `AIProvider` is a str-Enum, whose str() is "AIProvider.OLLAMA" rather
    # than "ollama" on Python < 3.11 -- take .value when there is one.
    requested_provider = str(getattr(provider, "value", provider) or "")
    requested_model = str(getattr(model, "value", model) or "")
    provider, model = ai_settings.resolve_target(requested_provider, requested_model)
    if (provider, model) != (requested_provider, requested_model):
        logger.info(
            "AI target resolved: %s/%s -> %s/%s",
            requested_provider or "(default)", requested_model or "(default)", provider, model,
        )

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
    model: str = "",
    provider: AIProvider = AIProvider.DEFAULT,
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


async def _generate_tagged(
    system: str,
    tag: str,
    description: str,
    context: str,
    model: str,
    provider: AIProvider,
    temperature: float = 0.3,
) -> tuple[str, str]:
    """
    Ask the model for one piece of text wrapped in `<tag>...</tag>`, and split
    the reply into (that text, the explanation that follows it).

    Three generators want exactly this -- a system prompt, an output-format
    description, a data-format contract. They differ only in their system
    prompt (which is the actual content, and stays with each function) and in
    the tag name. A model that ignores the tags falls back to the whole reply,
    which is better than returning nothing.
    """
    prompt = f"Task description: {description}"
    if context:
        prompt += f"\n\nAdditional context: {context}"
    raw = await complete(prompt, system, model, temperature, provider)

    match = re.search(rf"<{tag}>(.*?)</{tag}>", raw, re.DOTALL)
    if match:
        return match.group(1).strip(), raw[match.end():].strip()
    return raw.strip(), ""


async def generate_prompt(
    description: str,
    context: str = "",
    model: str = "",
    provider: AIProvider = AIProvider.DEFAULT,
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
    return await _generate_tagged(system, "system_prompt", description, context, model, provider)


async def generate_output_format(
    description: str,
    context: str = "",
    model: str = "",
    provider: AIProvider = AIProvider.DEFAULT,
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
    return await _generate_tagged(system, "output_format", description, context, model, provider)


async def generate_data_format(
    description: str,
    context: str = "",
    model: str = "",
    provider: AIProvider = AIProvider.DEFAULT,
) -> tuple[str, str]:
    """
    Ask the LLM to design a `data` node's format contract (config.data_format_prompt).
    A `data` node only distinguishes "text" vs. "structure" (config.data_format) --
    all the actual shape detail (field names, types, nesting, dimensions) lives in
    this free-text prompt, so the system prompt below asks the model to propose a
    few candidate structures, weigh them against any example input given as
    *context*, then commit to one. Returns (format_description, explanation).
    """
    system = (
        "You are an expert at designing the data format/schema a graph \"data\" "
        "node should persist. Given a task description and, if provided, example "
        "input data, propose two or three plausible candidate formats (field "
        "names, types, nesting, or structure), briefly weigh their tradeoffs "
        "against the given examples, then commit to the single best one.\n\n"
        "Example:\n"
        "Task description: Store the extracted invoice line items.\n"
        "Example data: \"3x Widget @ 9.99, 1x Gadget @ 19.99\"\n"
        "Candidate formats:\n"
        "1. A flat list of strings, one per line item.\n"
        "2. A JSON array of {name, quantity, unit_price} objects.\n"
        "3. A single JSON object keyed by item name mapping to quantity.\n"
        "Chosen format: option 2, because line items need distinct quantity and "
        "price fields for later calculations, and a list naturally accommodates "
        "any number of items.\n"
        "<data_format>A JSON array of objects, each with \"name\" (string), "
        "\"quantity\" (integer), and \"unit_price\" (number), e.g. "
        "[{\"name\": \"Widget\", \"quantity\": 3, \"unit_price\": 9.99}].</data_format>\n\n"
        "Now do the same for the given task: think through candidate proposals and "
        "your reasoning as plain text, then put only the final chosen format "
        "description (field names, types, nesting, and a representative example "
        "value) inside <data_format> tags, followed by a brief explanation."
    )
    return await _generate_tagged(system, "data_format", description, context, model, provider)


async def generate_graph(
    description: str,
    context: str = "",
    model: str = "",
    provider: AIProvider = AIProvider.DEFAULT,
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
        "Valid node_type values: input, data, ai, code, output, gui. An \"input\" node's "
        "config.input_mode selects text, file, or directory input. "
        "A \"data\" node is persisted graph memory with one optional input port named "
        "\"input\" and one output port named \"output\". Define data nodes before code or "
        "ai nodes when a workflow has known intermediate contracts. Set config.data_format "
        "to text or structure; put the precise schema, field names, types, nesting, and "
        "constraints in config.data_format_prompt; and initialize config.data_value when "
        "useful. Connected code and ai nodes must honor those source and target contracts. "
        "There is no dedicated "
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

    match = re.search(r"```json\n(.*?)```", raw, re.DOTALL)
    explanation = raw[match.end() :].strip() if match else ""
    return graph_dict, explanation


def _extract_code_block(text: str) -> str:
    """Extract the first fenced code block from markdown text."""
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
    match = re.search(r"```json\n(.*?)```", text, re.DOTALL)
    candidate = match.group(1).strip() if match else text.strip()
    try:
        return json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        return None
