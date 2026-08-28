"""
AI-generation router – code and prompt generation endpoints.
"""

from __future__ import annotations

import csv
import io
import json
import asyncio
import logging
import os
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from app.elements.registry import generation_for
from app.models.graph import (
    CodeProbeReport,
    GenerateGraphRequest,
    GenerateGraphResponse,
    GenerateRequest,
    GenerateResponse,
)
from app.services import ai_service, ai_settings, code_env, code_refine, file_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/providers")
async def provider_status():
    """
    Which AI providers are actually usable right now: probes the local ones
    (ollama, LM Studio) for reachability and served models -- so the editor
    can offer a model dropdown instead of a blind free-text field -- and
    reports what the current run/generation targets resolve to.
    """
    import asyncio

    async def probe(provider: str):
        return provider, await asyncio.to_thread(ai_settings.probe_local_models, provider, 1.5, True)

    results = dict(await asyncio.gather(*(probe(p) for p in ai_settings.LOCAL_PROVIDERS)))
    runtime_provider, runtime_model = ai_settings.resolve_target("default", "")
    gen_provider, gen_model = ai_settings.resolve_gen_target("", "")
    return {
        "local": {
            provider: {"reachable": models is not None, "models": models or []}
            for provider, models in results.items()
        },
        "runtime_target": {"provider": runtime_provider, "model": runtime_model},
        "gen_target": {"provider": gen_provider, "model": gen_model},
    }


def _gen_target(req) -> tuple[str, str]:
    """
    Which AI writes this code/prompt. The editor sends its one configured
    code-generation AI with every request; when it sends nothing (a fresh
    browser, a script calling the API directly), the server's own default
    fills in -- see ai_settings.resolve_gen_target. Nodes no longer carry a
    generation provider of their own.
    """
    provider = str(getattr(req.ai_provider, "value", req.ai_provider) or "")
    return ai_settings.resolve_gen_target(provider, req.ai_model or "")


def _parsed_preview(content: str, format_name: str) -> str:
    """Best-effort structured preview so generation can reason about sample data shape."""
    normalized = (format_name or "").lower()
    try:
        if normalized in ("csv", "text/csv"):
            rows = list(csv.DictReader(io.StringIO(content)))
            return json.dumps(rows[:8], indent=2, ensure_ascii=False)
        if normalized in ("json", "application/json"):
            parsed = json.loads(content)
            if isinstance(parsed, list):
                parsed = parsed[:8]
            return json.dumps(parsed, indent=2, ensure_ascii=False)
        if normalized == "jsonl":
            records = []
            for line in content.splitlines():
                line = line.strip()
                if not line:
                    continue
                records.append(json.loads(line))
                if len(records) >= 8:
                    break
            return json.dumps(records, indent=2, ensure_ascii=False)
    except Exception:
        return ""
    return ""


def _with_context_file(context: str, context_file: str) -> str:
    """Append a context file's content (read server-side) to *context*, if given."""
    if not context_file:
        return context
    try:
        content = file_service.read_file(context_file, mode="text")
        detected = file_service.detect_format(context_file)
    except (FileNotFoundError, OSError) as exc:
        raise HTTPException(400, f"Could not read context file: {exc}") from exc
    preview = _parsed_preview(content, detected)
    file_context = f"Context file ({context_file}, format={detected}):\n{content}"
    if preview:
        file_context = f"{file_context}\n\nParsed preview (up to 8 records/items):\n{preview}"
    return f"{context}\n\n{file_context}" if context else file_context


async def _generated(name: str, coro):
    """
    Run one generation call and turn any failure into a 500 with the message.

    All five endpoints below wanted the identical try/except/log, and a
    generation that fails is a 500 with the provider's own message every time --
    a local model that is not running, a missing key, an unreachable endpoint.
    An HTTPException raised deeper (a context file that cannot be read) is
    already the right answer and passes through untouched.
    """
    try:
        return await coro
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("%s failed", name)
        raise HTTPException(500, str(exc)) from exc


# Which settings key holds the endpoint / credential for each provider. Same
# mapping the deployed runtime uses (graph-runner/serve.py) -- the editor was
# the only surface that could pick a hosted provider without being able to
# supply the key it needs.
_ENDPOINT_KEYS = {
    "ollama": "ollama_base_url",
    "lmstudio": "lmstudio_base_url",
    "openai_compatible": "openai_compatible_base_url",
    "google": "google_base_url",
    "github_copilot": "github_models_base_url",
}
_CREDENTIAL_KEYS = {
    "openai": "openai",
    "anthropic": "anthropic",
    "openai_compatible": "openai_compatible",
    "google": "google",
    "github_copilot": "github",
}
# Env var that satisfies a provider's credential without the settings file, so
# the UI can say "already configured" instead of demanding a key twice.
_CREDENTIAL_ENV = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openai_compatible": "OPENAI_COMPATIBLE_API_KEY",
    "google": "GOOGLE_API_KEY",
    "github_copilot": "GITHUB_TOKEN",
}


def _credentials_state() -> dict:
    """Per provider: whether a key is available, and where it came from -- never
    the key itself. The editor only needs to know that it is set."""
    stored = ai_settings.settings().get("api_keys") or {}
    state = {}
    for provider, key in _CREDENTIAL_KEYS.items():
        from_env = bool(os.getenv(_CREDENTIAL_ENV[provider], "").strip())
        from_file = bool(str(stored.get(key) or "").strip())
        state[provider] = {
            "configured": from_env or from_file,
            "source": "environment" if from_env else "settings file" if from_file else "",
        }
    return state


@router.get("/settings")
async def read_ai_settings():
    """Endpoints and credential *status* for the editor's Settings dialog.

    API keys are deliberately never returned -- the dialog shows whether one is
    set and lets you replace it, which is all it needs to do.
    """
    endpoints = ai_settings.settings().get("endpoints") or {}
    return {
        "settings_file": str(ai_settings.settings_path()),
        "settings_file_exists": ai_settings.settings_path().is_file(),
        "endpoint_keys": _ENDPOINT_KEYS,
        "endpoints": {name: str(endpoints.get(key) or "") for name, key in _ENDPOINT_KEYS.items()},
        "credentials": _credentials_state(),
    }


@router.post("/settings")
async def write_ai_settings(body: Dict[str, Any]):
    """Merge endpoints/API keys into the settings file.

    Merging rather than replacing, and treating an empty string as "leave alone",
    means saving one provider's key never clears another's -- and that a dialog
    which cannot read keys back can still save without wiping them.
    """
    current = dict(ai_settings.settings())
    endpoints = dict(current.get("endpoints") or {})
    keys = dict(current.get("api_keys") or {})

    for provider, value in (body.get("endpoints") or {}).items():
        settings_key = _ENDPOINT_KEYS.get(provider)
        if settings_key:
            endpoints[settings_key] = str(value or "").strip()
    for provider, value in (body.get("api_keys") or {}).items():
        settings_key = _CREDENTIAL_KEYS.get(provider)
        text = str(value or "").strip()
        if settings_key and text:
            keys[settings_key] = text

    # An explicit clear is separate from "left blank", which means unchanged.
    for provider in body.get("clear_keys") or []:
        settings_key = _CREDENTIAL_KEYS.get(provider)
        if settings_key:
            keys.pop(settings_key, None)

    current["endpoints"] = endpoints
    current["api_keys"] = keys
    try:
        path = ai_settings.save(current)
    except OSError as exc:
        raise HTTPException(500, f"Could not write {ai_settings.settings_path()}: {exc}") from exc
    return {"settings_file": str(path), "credentials": _credentials_state(),
            "endpoints": {n: str(endpoints.get(k) or "") for n, k in _ENDPOINT_KEYS.items()}}


@router.get("/code-env")
async def code_env_status():
    """Where code nodes run, and whether that environment exists yet."""
    return code_env.describe()


@router.post("/code-env/install")
async def code_env_install(body: Dict[str, Any]):
    """
    Install the packages a code node declares. Explicit rather than automatic:
    it needs the network and can take minutes, which a Run button should not do
    behind the user's back.
    """
    requirements = code_env.normalise(body.get("requirements") or [])
    if not requirements:
        return {"installed": [], "missing": [], **code_env.describe()}
    try:
        installed, log = await asyncio.to_thread(code_env.install, requirements)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "installed": installed,
        "missing": code_env.missing(requirements),
        "log": log[-4000:],
        **code_env.describe(),
    }


# ---------------------------------------------------------------------------
# One generation endpoint, for every element.
#
# There were four -- generate-code, generate-prompt, generate-output-format,
# generate-data-format -- with the same request shape, the same _gen_target, the
# same _with_context_file and the same try/except, differing only in which
# ai_service function they called and what they named the one string they
# returned. The editor mirrored that split in five hand-written call sites. What
# actually varies is declared on the element (see `Generation`), so the dispatch
# below is a table lookup rather than a branch, and adding a generating element
# adds no route.
#
# `generate-graph` below is deliberately not folded in: it authors a whole Graph
# document rather than one element's body, so it shares neither the request nor
# the response.
# ---------------------------------------------------------------------------


def _text_generator(name: str):
    """Adapt one of ai_service's tagged generators to the uniform signature.

    Resolved by name at call time rather than captured at import: a table of
    frozen function references quietly ignores anything that rebinds
    `ai_service.generate_prompt` afterwards -- a test double, or a future
    provider shim -- and does it silently, by reaching the network instead.
    """
    async def run(req: GenerateRequest, spec, context: str, model: str, provider: str) -> GenerateResponse:
        text, explanation = await getattr(ai_service, name)(
            description=req.description, context=context, model=model, provider=provider,
        )
        return GenerateResponse(result=text, explanation=explanation)
    return run


async def _code_generator(req: GenerateRequest, spec, context: str, model: str, provider: str) -> GenerateResponse:
    """Code, verified against real data when the caller sent some.

    A fixed-port snippet (a selector's `files`, a transform's `value`) declares
    its own ports and is not wired to the ones a sample is keyed by, so it gets
    the ordinary single pass rather than a probe against mismatched inputs.
    """
    fixed_ports = spec is not None and spec.inputs is not None
    code, explanation, report = await code_refine.generate_verified_code(
        description=req.description,
        language=req.language,
        context=context,
        inputs=list(spec.inputs) if fixed_ports else req.inputs,
        outputs=list(spec.outputs) if fixed_ports and spec.outputs else req.outputs,
        model=model,
        provider=provider,
        sample_inputs=None if fixed_ports else req.sample_inputs,
    )
    return GenerateResponse(result=code, explanation=explanation,
                            probe=CodeProbeReport(**report.as_dict()))


_GENERATORS = {
    "code": _code_generator,
    "prompt": _text_generator("generate_prompt"),
    "output_format": _text_generator("generate_output_format"),
    "data_format": _text_generator("generate_data_format"),
}


@router.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    """Generate one element's authored text, whatever the element is."""
    spec = generation_for(req.element) if req.element else None
    if req.element and spec is None:
        raise HTTPException(400, f"{req.element!r} is not an element that generates anything")
    kind = spec.kind if spec is not None else req.kind
    generator = _GENERATORS.get(kind)
    if generator is None:
        raise HTTPException(400, f"Unknown generation kind {kind!r}")
    gen_provider, gen_model = _gen_target(req)
    # The element's own contract first: it says what the running engine will do
    # with this snippet, which the rest of the context cannot imply.
    context = "\n\n".join(part for part in ((spec.contract if spec else ""), req.context) if part)
    context = _with_context_file(context, req.context_file)
    return await _generated("generate", generator(req, spec, context, gen_model, gen_provider))


@router.post("/generate-graph", response_model=GenerateGraphResponse)
async def generate_graph(req: GenerateGraphRequest):
    """Ask the AI to author a full Graph DSL document from a natural-language description."""
    gen_provider, gen_model = _gen_target(req)
    graph_dict, explanation = await _generated("generate_graph", ai_service.generate_graph(
        description=req.description,
        context=req.context,
        model=gen_model,
        provider=gen_provider,
    ))
    # Constructing with graph=graph_dict validates it against the full Graph schema.
    return GenerateGraphResponse(graph=graph_dict, explanation=explanation)


@router.post("/complete")
async def ai_complete(body: dict):
    """Raw AI completion endpoint."""
    try:
        from app.models.graph import AIProvider
        provider = AIProvider(body.get("provider", "ollama"))
        response = await ai_service.complete(
            prompt=body.get("prompt", ""),
            system=body.get("system", ""),
            model=body.get("model", "llama3"),
            temperature=float(body.get("temperature", 0.7)),
            provider=provider,
        )
        return {"response": response}
    except Exception as exc:
        logger.exception("ai_complete failed")
        raise HTTPException(500, str(exc)) from exc
