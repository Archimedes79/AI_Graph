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


@router.post("/generate-code", response_model=GenerateCodeResponse)
async def generate_code(req: GenerateCodeRequest):
    """Ask the AI to generate code for a node's description."""
    gen_provider, gen_model = _gen_target(req)
    try:
        code, explanation = await ai_service.generate_code(
            description=req.description,
            language=req.language,
            context=_with_context_file(req.context, req.context_file),
            inputs=req.inputs,
            outputs=req.outputs,
            model=gen_model,
            provider=gen_provider,
        )
        return GenerateCodeResponse(code=code, language=req.language, explanation=explanation)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("generate_code failed")
        raise HTTPException(500, str(exc)) from exc


@router.post("/generate-prompt", response_model=GeneratePromptResponse)
async def generate_prompt(req: GeneratePromptRequest):
    """Ask the AI to generate a system prompt from a natural-language description."""
    gen_provider, gen_model = _gen_target(req)
    try:
        sp, explanation = await ai_service.generate_prompt(
            description=req.description,
            context=_with_context_file(req.context, req.context_file),
            model=gen_model,
            provider=gen_provider,
        )
        return GeneratePromptResponse(system_prompt=sp, explanation=explanation)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("generate_prompt failed")
        raise HTTPException(500, str(exc)) from exc


@router.post("/generate-output-format", response_model=GenerateOutputFormatResponse)
async def generate_output_format(req: GenerateOutputFormatRequest):
    """Ask the AI to describe the expected output format/shape from a description."""
    gen_provider, gen_model = _gen_target(req)
    try:
        fmt, explanation = await ai_service.generate_output_format(
            description=req.description,
            context=_with_context_file(req.context, req.context_file),
            model=gen_model,
            provider=gen_provider,
        )
        return GenerateOutputFormatResponse(output_format_prompt=fmt, explanation=explanation)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("generate_output_format failed")
        raise HTTPException(500, str(exc)) from exc


@router.post("/generate-data-format", response_model=GenerateOutputFormatResponse)
async def generate_data_format(req: GenerateOutputFormatRequest):
    """Ask the AI to design a data node's format contract, proposing then picking one option."""
    gen_provider, gen_model = _gen_target(req)
    try:
        fmt, explanation = await ai_service.generate_data_format(
            description=req.description,
            context=_with_context_file(req.context, req.context_file),
            model=gen_model,
            provider=gen_provider,
        )
        return GenerateOutputFormatResponse(output_format_prompt=fmt, explanation=explanation)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("generate_data_format failed")
        raise HTTPException(500, str(exc)) from exc


@router.post("/generate-graph", response_model=GenerateGraphResponse)
async def generate_graph(req: GenerateGraphRequest):
    """Ask the AI to author a full Graph DSL document from a natural-language description."""
    gen_provider, gen_model = _gen_target(req)
    try:
        graph_dict, explanation = await ai_service.generate_graph(
            description=req.description,
            context=req.context,
            model=gen_model,
            provider=gen_provider,
        )
        # Constructing with graph=graph_dict validates it against the full Graph schema.
        return GenerateGraphResponse(graph=graph_dict, explanation=explanation)
    except Exception as exc:
        logger.exception("generate_graph failed")
        raise HTTPException(500, str(exc)) from exc


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
