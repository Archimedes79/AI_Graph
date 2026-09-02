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
from fastapi.responses import JSONResponse

from app.services.generation import generation_for
from app.models.graph import (
    AICall,
    CodeProbeReport,
    GenerateGraphRequest,
    GenerateGraphResponse,
    GenerateRequest,
    GenerateResponse,
)
from app.services import ai_service, ai_settings, code_refine, file_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"])


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
        context=context,
        inputs=list(spec.inputs) if fixed_ports else req.inputs,
        outputs=list(spec.outputs) if fixed_ports and spec.outputs else req.outputs,
        model=model,
        provider=provider,
        sample_inputs=None if fixed_ports else req.sample_inputs,
        sources=None if fixed_ports else (req.input_sources or None),
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
    spec = await generation_for(req.element) if req.element else None
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

    # Record every model call this generation makes, so the editor can show what
    # was sent. Set per request rather than globally: two generations in flight
    # must not write into each other's transcript.
    calls: list = []
    token = ai_service.transcript.set(calls)
    try:
        response = await _generated("generate", generator(req, spec, context, gen_model, gen_provider))
    except HTTPException as exc:
        # The failing generation is the one whose transcript is worth reading --
        # "no content, the model may still be loading or the request exceeded
        # its context window" is only answerable by seeing what was sent. An
        # HTTPException body is a bare `detail`, so the error is returned rather
        # than raised, to carry `calls` alongside it in the same shape a success
        # has. `detail` keeps its place, so every existing reader still works.
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "calls": [AICall(**call).model_dump() for call in calls]},
        )
    finally:
        ai_service.transcript.reset(token)
    response.calls = [AICall(**call) for call in calls]
    return response


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
