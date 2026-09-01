"""
Two-pass code generation: generate, run it against real data, repair once.

A single generation pass is a guess. The model does not know whether
`inputs["files"]` arrives as a list or a scalar, whether the upstream node's
JSON has the field it assumed, or whether the key it chose for its result
matches the port the next node reads -- and a wrong output key is the single
most common way generated code "works" and still delivers nothing.

All of that becomes knowable the moment the code is executed once. So when the
caller can supply a realistic input sample -- the editor takes it from the last
run's values for this very node -- the generated function is run in the same
sandbox a real run would use, and what comes back is fed into a second pass:

    pass 1  ->  probe  ->  ok            -> keep pass 1, report it was verified
                       ->  error/mismatch -> pass 2 with the evidence -> probe again

The second pass is not "try again", it is "here is exactly what went wrong".
That difference is why one extra round is usually enough, and why there is no
third: if the model cannot fix a fault it has been shown verbatim, another
identical nudge will not help either, and the user is better served by the code
plus an honest note than by a slow loop.

Probing executes model-written code. It goes through `code_executor`, the same
sandboxed subprocess with the same timeout that every real run uses, so it adds
no capability the graph did not already have -- only the timing changes: the
code runs before the user has read it rather than after. Callers that would
rather not have that can leave the sample out, which turns the whole thing off.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from app.services import ai_service, code_executor

logger = logging.getLogger(__name__)

# A probe is a smoke test, not a run: a function that needs longer than this on
# one sample is doing something the second pass cannot fix anyway.
PROBE_TIMEOUT_SECONDS = 25.0

# How much of a value to quote back to the model. Enough to show the shape,
# little enough that a directory listing does not eat the context window.
_PREVIEW_LIMIT = 900


@dataclass
class ProbeReport:
    """What running the generated code told us. Also what the editor shows."""

    status: str = "skipped"          # skipped | ok | repaired | failed
    attempts: int = 0
    error: str = ""                  # the failure the user should know about
    missing_outputs: List[str] = field(default_factory=list)
    output_preview: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "attempts": self.attempts,
            "error": self.error,
            "missing_outputs": self.missing_outputs,
            "output_preview": self.output_preview,
        }


def _preview(value: Any) -> str:
    """A short, faithful rendering of a value for the model and the user."""
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        text = repr(value)
    if len(text) > _PREVIEW_LIMIT:
        text = text[:_PREVIEW_LIMIT] + f"… (+{len(text) - _PREVIEW_LIMIT} characters)"
    return text


def _describe_inputs(sample: Dict[str, Any]) -> str:
    """One line per input port: its type and an excerpt of its actual value."""
    lines = []
    for key, value in sample.items():
        kind = type(value).__name__
        if isinstance(value, list):
            kind = f"list[{len(value)}]"
            if value:
                kind += f" of {type(value[0]).__name__}"
        lines.append(f'  inputs["{key}"]: {kind} = {_preview(value)}')
    return "\n".join(lines)


async def _probe(code: str, sample: Dict[str, Any], outputs: List[str]):
    """
    Run *code* once on *sample*.

    Returns (result, error_text). Exactly one of them is meaningful: a result
    dict when the function ran, an error string when it raised, timed out, or
    returned something that is not a dict.
    """
    try:
        result = await asyncio.wait_for(
            code_executor.execute_code(code, dict(sample)),
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return None, f"The function did not finish within {PROBE_TIMEOUT_SECONDS:.0f}s on one sample item."
    except Exception as exc:  # the sandbox re-raises the user code's own traceback
        return None, str(exc).strip()

    if not isinstance(result, dict):
        return None, f"run() returned {type(result).__name__}, but it must return a dict."
    return result, ""


def _repair_prompt(code: str, sample: Dict[str, Any], error: str, missing: List[str], outputs: List[str]) -> str:
    """The evidence block handed to the second pass."""
    parts = [
        "Your previous attempt was executed against real data and did not work. "
        "Fix it. Return the complete corrected function, not a patch.",
        "",
        "--- your previous attempt ---",
        code,
        "",
        "--- the inputs it actually received ---",
        _describe_inputs(sample) or "  (no inputs)",
    ]
    if error:
        parts += ["", "--- the error it raised ---", error]
    if missing:
        parts += [
            "",
            "--- wrong result keys ---",
            f"It ran, but the returned dict is missing {missing!r}. "
            f"The declared output ports are {outputs!r}; downstream nodes look values up by "
            "exactly these keys, so every one of them must be present in the returned dict.",
        ]
    return "\n".join(parts)


async def generate_verified_code(
    *,
    description: str,
    context: str,
    inputs: List[str],
    outputs: List[str],
    model: str,
    provider: Any,
    sample_inputs: Optional[Dict[str, Any]] = None,
    sources: Optional[Dict[str, str]] = None,
) -> tuple[str, str, ProbeReport]:
    """
    Generate code and, when a sample is available, verify it by running it.

    Returns (code, explanation, report). The code is always the best one
    obtained: pass 2's if it improved things, pass 1's otherwise -- a failed
    repair never leaves the user with something worse than the first attempt.
    """
    code, explanation = await ai_service.generate_code(
        description=description, context=context,
        inputs=inputs, outputs=outputs, model=model, provider=provider,
        # The same sample that verifies the result also types the skeleton
        # the model is asked to complete -- pass 1 gets to see the shapes
        # that, before, only the repair pass ever learned.
        sample_inputs=sample_inputs, sources=sources,
    )

    report = ProbeReport()
    if not sample_inputs:
        # Nothing to run it against -- the node has never produced a value, or
        # the caller opted out. One honest pass is the whole answer.
        return code, explanation, report

    report.attempts = 1
    result, error = await _probe(code, sample_inputs, outputs)
    missing = [] if result is None else [port for port in outputs if port not in result]

    if result is not None and not missing:
        report.status = "ok"
        report.output_preview = _preview(result)
        return code, explanation, report

    logger.info(
        "Generated code failed its probe (error=%s, missing=%s); running a repair pass.",
        error or "-", missing,
    )

    repair_context = "\n\n".join(filter(None, [
        context,
        _repair_prompt(code, sample_inputs, error, missing, outputs),
    ]))
    try:
        repaired, repaired_explanation = await ai_service.generate_code(
            description=description, context=repair_context,
            inputs=inputs, outputs=outputs, model=model, provider=provider,
            sample_inputs=sample_inputs, sources=sources,
        )
    except Exception as exc:
        # The repair pass is a bonus, never a reason to fail the request: hand
        # back the first attempt and say what was wrong with it.
        logger.warning("Repair pass failed: %s", exc)
        report.status = "failed"
        report.error = error
        report.missing_outputs = missing
        return code, explanation, report

    report.attempts = 2
    repaired_result, repaired_error = await _probe(repaired, sample_inputs, outputs)
    repaired_missing = [] if repaired_result is None else [p for p in outputs if p not in repaired_result]

    if repaired_result is not None and not repaired_missing:
        report.status = "repaired"
        report.output_preview = _preview(repaired_result)
        return repaired, repaired_explanation, report

    # Still broken. Keep the attempt that got further -- running with wrong keys
    # beats not running at all -- and tell the user what remains.
    if result is not None and repaired_result is None:
        report.status = "failed"
        report.error = error
        report.missing_outputs = missing
        return code, explanation, report

    report.status = "failed"
    report.error = repaired_error
    report.missing_outputs = repaired_missing
    return repaired, repaired_explanation, report
