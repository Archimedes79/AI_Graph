"""
AI-generation router – code and prompt generation endpoints.
"""

from __future__ import annotations

import csv
import io
import json
import logging

from fastapi import APIRouter, HTTPException

from app.models.graph import (
    GenerateCodeRequest,
    GenerateCodeResponse,
    GenerateGraphRequest,
    GenerateGraphResponse,
    GenerateOutputFormatRequest,
    GenerateOutputFormatResponse,
    GeneratePromptRequest,
    GeneratePromptResponse,
)
from app.services import ai_service, ai_settings, file_service

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


@router.post("/generate-code", response_model=GenerateCodeResponse)
async def generate_code(req: GenerateCodeRequest):
    """Ask the AI to generate code for a node's description."""
    gen_provider, gen_model = _gen_target(req)
    code, explanation = await _generated("generate_code", ai_service.generate_code(
        description=req.description,
        language=req.language,
        context=_with_context_file(req.context, req.context_file),
        inputs=req.inputs,
        outputs=req.outputs,
        model=gen_model,
        provider=gen_provider,
    ))
    return GenerateCodeResponse(code=code, language=req.language, explanation=explanation)


@router.post("/generate-prompt", response_model=GeneratePromptResponse)
async def generate_prompt(req: GeneratePromptRequest):
    """Ask the AI to generate a system prompt from a natural-language description."""
    gen_provider, gen_model = _gen_target(req)
    system_prompt, explanation = await _generated("generate_prompt", ai_service.generate_prompt(
        description=req.description,
        context=_with_context_file(req.context, req.context_file),
        model=gen_model,
        provider=gen_provider,
    ))
    return GeneratePromptResponse(system_prompt=system_prompt, explanation=explanation)


@router.post("/generate-output-format", response_model=GenerateOutputFormatResponse)
async def generate_output_format(req: GenerateOutputFormatRequest):
    """Ask the AI to describe the expected output format/shape from a description."""
    gen_provider, gen_model = _gen_target(req)
    fmt, explanation = await _generated("generate_output_format", ai_service.generate_output_format(
        description=req.description,
        context=_with_context_file(req.context, req.context_file),
        model=gen_model,
        provider=gen_provider,
    ))
    return GenerateOutputFormatResponse(output_format_prompt=fmt, explanation=explanation)


@router.post("/generate-data-format", response_model=GenerateOutputFormatResponse)
async def generate_data_format(req: GenerateOutputFormatRequest):
    """Ask the AI to design a data node's format contract, proposing then picking one option."""
    gen_provider, gen_model = _gen_target(req)
    fmt, explanation = await _generated("generate_data_format", ai_service.generate_data_format(
        description=req.description,
        context=_with_context_file(req.context, req.context_file),
        model=gen_model,
        provider=gen_provider,
    ))
    return GenerateOutputFormatResponse(output_format_prompt=fmt, explanation=explanation)


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
