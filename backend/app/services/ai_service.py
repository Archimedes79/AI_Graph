"""
AI service – wraps Ollama (default), OpenAI, and Anthropic calls.
All providers expose a common `complete(prompt, system, model, temperature)` interface.
"""

from __future__ import annotations

import json
import logging
import asyncio
import os
import re
import time
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

import httpx

from app.models.graph import AIProvider
from app.services import ai_settings, file_service, skeleton

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LMSTUDIO_BASE_URL = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")
OPENAI_COMPATIBLE_BASE_URL = os.getenv("OPENAI_COMPATIBLE_BASE_URL", "")
OPENAI_COMPATIBLE_API_KEY = os.getenv("OPENAI_COMPATIBLE_API_KEY", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_MODELS_BASE_URL = os.getenv("GITHUB_MODELS_BASE_URL", "https://models.github.ai/inference")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
# Google's own OpenAI-compatibility layer for the Gemini API, which is why
# supporting it is a table entry rather than a provider implementation.
GOOGLE_BASE_URL = os.getenv("GOOGLE_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")


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


def _google_api_key() -> str:
    return ai_settings.credential("GOOGLE_API_KEY", GOOGLE_API_KEY, "google")


def _google_base_url() -> str:
    return ai_settings.endpoint("GOOGLE_BASE_URL", GOOGLE_BASE_URL, "google_base_url")

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

# Liveness for whoever is watching this run.
#
# `complete()` is called from inside a node element, which knows nothing about a
# run watching it -- and threading a callback down through every element's
# `execute` signature to reach here would move run bookkeeping into the element
# contract, where it does not belong. A ContextVar keeps it out: each asyncio
# Task inherits its own copy, so nodes running concurrently in one level never
# report activity for each other.
#
# Called with the number of characters received so far, at the same throttled
# cadence as the progress log. Must not raise and must not block.
stream_activity: ContextVar[Optional[Callable[[int], None]]] = ContextVar(
    "ai_stream_activity", default=None
)

# Every model call of the current request, in order, for anyone who wants to
# see what was sent. Set to a list by a caller that cares; left None otherwise,
# so a run that nobody is watching records nothing.
#
# A ContextVar for the same reason as the one above: two generations in flight
# at once must not write into each other's record, and `complete()` is the one
# place every call goes through.
transcript: ContextVar[Optional[List[Dict[str, Any]]]] = ContextVar(
    "ai_transcript", default=None
)


def _record(provider: str, model: str, system: str, prompt: str) -> Optional[Dict[str, Any]]:
    """Start an entry for this call. Returns it so the answer can be added."""
    log = transcript.get()
    if log is None:
        return None
    entry: Dict[str, Any] = {
        "provider": provider,
        "model": model,
        "system": system,
        "prompt": prompt,
        # Counted here rather than in the browser: "how much did I send" is the
        # question a context-window error raises, and the answer should not
        # depend on which half is asked.
        "sent_chars": len(system) + len(prompt),
        "reply": None,
        "reply_chars": 0,
        "seconds": 0.0,
        "error": None,
    }
    log.append(entry)
    return entry


def _provider_error_detail(body: str) -> str:
    """The provider's own explanation, dug out of whatever JSON shape it used.

    OpenAI-style errors are `{"error": {"message": ...}}`; Google wraps the
    same object in a list. Anything unrecognised falls back to the raw body,
    truncated -- a partial sentence still beats no sentence.
    """
    try:
        parsed = json.loads(body)
    except (ValueError, TypeError):
        return body[:500]
    if isinstance(parsed, list):
        parsed = parsed[0] if parsed else {}
    if isinstance(parsed, dict):
        error = parsed.get("error", parsed)
        if isinstance(error, dict):
            message = error.get("message") or error.get("detail")
            if message:
                return str(message)
    return body[:500]


async def _raise_for_status_with_body(response: httpx.Response) -> None:
    """`raise_for_status()` for a *streaming* response, with the provider's
    explanation kept.

    A streamed response's body has not been read when the status line arrives,
    so httpx's own error is only "Client error '404 Not Found' for url ..." --
    which reads like a broken endpoint even when the provider said something
    precise and actionable ("this model is no longer available"). That sentence
    is the entire diagnosis, so read the body before raising.
    """
    if not response.is_error:
        return
    body = (await response.aread()).decode("utf-8", errors="replace").strip()
    detail = _provider_error_detail(body)
    raise httpx.HTTPStatusError(
        f"{response.status_code} {response.reason_phrase} from {response.request.url}"
        + (f" -- {detail}" if detail else ""),
        request=response.request,
        response=response,
    )


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
            received = sum(len(c) for c in self._chunks)
            logger.info(
                "AI stream progress <- provider=%s model=%s after %.1fs (%d chars so far)",
                self._provider, self._model, now - self._start, received,
            )
            # Same cadence, but out to the UI rather than the console: this is
            # what lets a watcher tell "slow" from "hung" during a long call.
            report = stream_activity.get()
            if report is not None:
                report(received)
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
        await _raise_for_status_with_body(response)
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

# --- Vision ------------------------------------------------------------------
#
# Images travel as `data:` URLs and are turned into whatever shape the provider
# wants here. Four providers share the OpenAI content-parts format, which is why
# supporting vision is one function rather than one per provider -- LM Studio
# serving a vision model speaks exactly the same protocol as OpenAI does.

def _openai_user_content(prompt: str, images: Optional[List[str]]):
    """A user message body: the plain string when there are no images, the
    OpenAI content-parts list when there are."""
    if not images:
        return prompt
    parts: List[Dict[str, Any]] = []
    if prompt:
        parts.append({"type": "text", "text": prompt})
    for url in images:
        parts.append({"type": "image_url", "image_url": {"url": url}})
    return parts


def _anthropic_user_content(prompt: str, images: Optional[List[str]]):
    """Anthropic wants the media type and the base64 payload as separate fields
    rather than one data URL."""
    if not images:
        return prompt
    parts: List[Dict[str, Any]] = []
    for url in images:
        media_type, data = file_service.split_data_url(url)
        parts.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": data},
        })
    if prompt:
        parts.append({"type": "text", "text": prompt})
    return parts


def _ollama_images(images: Optional[List[str]]) -> List[str]:
    """Ollama takes bare base64 strings in an `images` key, no media type."""
    return [file_service.split_data_url(url)[1] for url in images or []]


async def _ollama_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = AI_COMPLETE_TIMEOUT,
    images: Optional[List[str]] = None,
) -> str:
    payload = {
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": True,
        "options": {"temperature": temperature, "num_predict": AI_MAX_TOKENS},
    }
    if images:
        payload["images"] = _ollama_images(images)
    progress = _StreamProgress("ollama", model)
    async with httpx.AsyncClient(timeout=_stream_timeout(timeout)) as client:
        async with client.stream("POST", f"{_ollama_base_url()}/api/generate", json=payload) as response:
            await _raise_for_status_with_body(response)
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
    # Gemini, through Google's OpenAI-compatible endpoint. A key from
    # aistudio.google.com has a free tier, which is what makes it the useful
    # hosted default for someone who does not want to pay to try the tool.
    "google": _OpenAIStyle(
        base_url=_google_base_url,
        credential=_google_api_key,
        credential_required=True,
        missing_credential_error=(
            "No Google API key configured (GOOGLE_API_KEY, or api_keys.google in "
            "ai-settings.json). Get one free at https://aistudio.google.com/apikey"
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
    images: Optional[List[str]] = None,
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
    messages.append({"role": "user", "content": _openai_user_content(prompt, images)})
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
    images: Optional[List[str]] = None,
) -> str:
    return await _openai_style_complete("openai", prompt, system, model, temperature, timeout, images)


async def _anthropic_complete(
    prompt: str,
    system: str,
    model: str,
    temperature: float,
    timeout: float = AI_COMPLETE_TIMEOUT,
    images: Optional[List[str]] = None,
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
        "messages": [{"role": "user", "content": _anthropic_user_content(prompt, images)}],
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
            await _raise_for_status_with_body(response)
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
    images: Optional[List[str]] = None,
) -> str:
    return await _openai_style_complete("lmstudio", prompt, system, model, temperature, timeout, images)


async def _openai_compatible_complete(
    prompt: str, system: str, model: str, temperature: float, timeout: float = AI_COMPLETE_TIMEOUT,
    images: Optional[List[str]] = None,
) -> str:
    return await _openai_style_complete("openai_compatible", prompt, system, model, temperature, timeout, images)


async def _google_complete(
    prompt: str, system: str, model: str, temperature: float, timeout: float = AI_COMPLETE_TIMEOUT,
    images: Optional[List[str]] = None,
) -> str:
    return await _openai_style_complete("google", prompt, system, model, temperature, timeout, images)


async def _github_copilot_complete(
    prompt: str, system: str, model: str, temperature: float, timeout: float = AI_COMPLETE_TIMEOUT,
    images: Optional[List[str]] = None,
) -> str:
    return await _openai_style_complete("github_copilot", prompt, system, model, temperature, timeout, images)


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

# Transient failures -- a local model still loading, a rate limit, a gateway
# blip -- used to fail the node and, before batches ran concurrently, the whole
# run with it. One retry pass costs a few seconds and removes the most common
# reason a long batch came back with holes in it.
AI_MAX_ATTEMPTS = max(1, int(os.getenv("AI_MAX_ATTEMPTS", "3")))
AI_RETRY_BASE_DELAY = float(os.getenv("AI_RETRY_BASE_DELAY", "1.0"))

# Status codes worth retrying: rate limiting, and the 5xx family that means
# "not you". A 400/401/404 is a configuration mistake -- retrying it just makes
# the user wait longer for the same message.
_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class EmptyCompletionError(RuntimeError):
    """A provider answered successfully with no content at all.

    Every provider path ends in `_StreamProgress.text()`, which is `""` when no
    chunk ever arrived -- a 200 with an empty stream. That raised nothing, so the
    retry loop below saw success, and the node returned an empty string
    downstream and reported SUCCESS. A local model still loading (LM Studio,
    ollama) does exactly this, which made "the graph ran and produced nothing"
    the single most confusing failure the editor could show.

    Retryable on purpose: an empty answer is almost always transient. The cost
    is that a *deliberately* empty answer now takes AI_MAX_ATTEMPTS before
    failing -- the right side to err on, because a visible error beats a silent
    empty string flowing into the rest of the graph.
    """


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRYABLE_STATUS
    if isinstance(exc, EmptyCompletionError):
        return True
    # Connect/read/timeout errors: the request never got a verdict.
    return isinstance(exc, (httpx.TransportError, httpx.TimeoutException))


async def complete(
    prompt: str,
    system: str = "",
    model: str = "",
    temperature: float = 0.7,
    provider: str = ai_settings.DEFAULT_SENTINEL,
    images: Optional[List[str]] = None,
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
    if not model:
        # Only reachable for `openai_compatible`, the one provider whose
        # endpoint is user-supplied and so has no default model to fall back
        # on. Say that here rather than calling with an empty model name and
        # letting the endpoint answer with a 404 that reads like a bad URL.
        raise ValueError(
            f"No model configured for provider '{provider}'. Name one on the AI node, "
            "or set ai.model in ai-settings.json / AI_GRAPH_AI_MODEL."
        )
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
    entry = _record(provider, model, system, prompt)
    async def call_provider() -> str:
        if provider == "ollama":
            return await _ollama_complete(prompt, system, model, temperature, images=images)
        if provider == "openai":
            return await _openai_complete(prompt, system, model, temperature, images=images)
        if provider == "openai_compatible":
            return await _openai_compatible_complete(prompt, system, model, temperature, images=images)
        if provider == "anthropic":
            return await _anthropic_complete(prompt, system, model, temperature, images=images)
        if provider == "lmstudio":
            return await _lmstudio_complete(prompt, system, model, temperature, images=images)
        if provider == "google":
            return await _google_complete(prompt, system, model, temperature, images=images)
        if provider == "github_copilot":
            return await _github_copilot_complete(prompt, system, model, temperature, images=images)
        raise ValueError(f"Unknown AI provider: {provider}")

    for attempt in range(1, AI_MAX_ATTEMPTS + 1):
        try:
            result = await call_provider()
            # Checked here rather than in each provider function: all seven end
            # in `_StreamProgress.text()`, so one guard covers every provider
            # including the next one somebody adds.
            if not result.strip():
                raise EmptyCompletionError(
                    f"{provider}/{model} returned no content. The model may still be "
                    "loading, or the request exceeded its context window."
                )
            break
        except Exception as exc:  # noqa: BLE001 - re-raised below unless retryable
            last = attempt == AI_MAX_ATTEMPTS
            if last or not _is_retryable(exc):
                logger.exception(
                    "AI request FAILED <- provider=%s model=%s after %.1fs (attempt %d/%d)",
                    provider, model, time.monotonic() - start, attempt, AI_MAX_ATTEMPTS,
                )
                # A transcript that showed only successes would be silent about
                # exactly the case someone opens it for.
                if entry is not None:
                    entry["error"] = str(exc)
                    entry["seconds"] = round(time.monotonic() - start, 2)
                raise
            delay = AI_RETRY_BASE_DELAY * (2 ** (attempt - 1))
            logger.warning(
                "AI request failed (%s); retrying in %.1fs -- attempt %d of %d",
                exc, delay, attempt + 1, AI_MAX_ATTEMPTS,
            )
            await asyncio.sleep(delay)
    logger.info(
        "AI response <- provider=%s model=%s after %.1fs (%d chars)\n--- response ---\n%s",
        provider, model, time.monotonic() - start, len(result), result,
    )
    if entry is not None:
        entry["reply"] = result
        entry["reply_chars"] = len(result)
        entry["seconds"] = round(time.monotonic() - start, 2)
    return result


async def generate_code(
    description: str,
    context: str = "",
    inputs: list[str] | None = None,
    outputs: list[str] | None = None,
    model: str = "",
    provider: AIProvider = AIProvider.DEFAULT,
    sample_inputs: Optional[Dict[str, Any]] = None,
    sources: Optional[Dict[str, str]] = None,
) -> tuple[str, str]:
    """
    Ask the LLM to generate code that maps *inputs* to *outputs*.
    Returns (code, explanation).

    *sample_inputs* (what the ports carried on the last run) and *sources* (the
    label of the node feeding each port) are optional and only sharpen the
    skeleton the model is asked to complete -- with neither, it still gets the
    signature instead of a comma-separated list of port names.
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
        "Write a JavaScript function that does the following:",
        description,
    ]
    if context:
        prompt_parts.append(f"\nContext:\n{context}")
    if inputs or outputs:
        # The signature rather than a list of port names. A model told
        # "Inputs: text, files" has to guess every type and every shape; the
        # skeleton states them, with the values the ports actually carried last
        # run when the caller supplied a sample.
        prompt_parts.append(
            "\nComplete this function. Keep the signature and the returned keys exactly as they are:\n\n"
            + skeleton.render(inputs, outputs, sample=sample_inputs, sources=sources)
        )
    if outputs:
        prompt_parts.append(
            f"\nThe returned dict's keys must be exactly: {outputs!r}. "
            "Downstream nodes look values up by these exact strings - do not rename, "
            "abbreviate, reorder, or invent additional keys, and include every one of them."
        )
    prompt_parts.append(
        "\nUse only what Node has built in. There is no package manager and no "
        "`npm install`: `require` and `import` of anything outside Node's own "
        "standard library will fail at run time."
    )
    raw = await complete("\n".join(prompt_parts), system, model, 0.2, provider)

    # Extract code block
    code = _extract_code_block(raw)
    explanation = raw.replace("```javascript", "").replace("```js", "").replace("```", "").strip()
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
