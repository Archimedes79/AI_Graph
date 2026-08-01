"""
AI-generation router – code and prompt generation endpoints.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.models.graph import (
    GenerateCodeRequest,
    GenerateCodeResponse,
    GeneratePromptRequest,
    GeneratePromptResponse,
)
from app.services import ai_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/generate-code", response_model=GenerateCodeResponse)
async def generate_code(req: GenerateCodeRequest):
    """Ask the AI to generate code for a node's description."""
    try:
        code, explanation = await ai_service.generate_code(
            description=req.description,
            language=req.language,
            context=req.context,
            inputs=req.inputs,
            outputs=req.outputs,
            model=req.ai_model,
            provider=req.ai_provider,
        )
        return GenerateCodeResponse(code=code, language=req.language, explanation=explanation)
    except Exception as exc:
        logger.exception("generate_code failed")
        raise HTTPException(500, str(exc)) from exc


@router.post("/generate-prompt", response_model=GeneratePromptResponse)
async def generate_prompt(req: GeneratePromptRequest):
    """Ask the AI to generate a system prompt from a natural-language description."""
    try:
        sp, explanation = await ai_service.generate_prompt(
            description=req.description,
            context=req.context,
            model=req.ai_model,
            provider=req.ai_provider,
        )
        return GeneratePromptResponse(system_prompt=sp, explanation=explanation)
    except Exception as exc:
        logger.exception("generate_prompt failed")
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
