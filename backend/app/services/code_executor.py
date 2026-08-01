"""
Code execution engine.
Runs Python or JavaScript code in a subprocess with a timeout.
The code module must expose a `run(inputs: dict) -> dict` function.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import tempfile
import textwrap
from typing import Any, Dict

logger = logging.getLogger(__name__)

EXECUTION_TIMEOUT = int(os.getenv("CODE_EXEC_TIMEOUT", "30"))


async def execute_python(code: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute Python code with the given inputs.
    The code must define a `run(inputs)` function that returns a dict.
    """
    wrapper = textwrap.dedent(
        f"""
import json, sys

{code}

_inputs = json.loads(sys.argv[1])
_outputs = run(_inputs)
print(json.dumps(_outputs))
"""
    )
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, encoding="utf-8"
    ) as f:
        f.write(wrapper)
        tmp_path = f.name

    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            tmp_path,
            json.dumps(inputs),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=EXECUTION_TIMEOUT
            )
        except asyncio.TimeoutError:
            proc.kill()
            raise TimeoutError(
                f"Code execution timed out after {EXECUTION_TIMEOUT}s"
            )

        if proc.returncode != 0:
            raise RuntimeError(stderr.decode().strip())

        raw = stdout.decode().strip()
        return json.loads(raw) if raw else {}

    finally:
        os.unlink(tmp_path)


async def execute_javascript(code: str, inputs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute JavaScript code with the given inputs via Node.js.
    The code must define a `run(inputs)` function that returns a plain object.
    """
    wrapper = textwrap.dedent(
        f"""
{code}

const _inputs = JSON.parse(process.argv[2]);
const _outputs = run(_inputs);
console.log(JSON.stringify(_outputs));
"""
    )
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".js", delete=False, encoding="utf-8"
    ) as f:
        f.write(wrapper)
        tmp_path = f.name

    try:
        proc = await asyncio.create_subprocess_exec(
            "node",
            tmp_path,
            json.dumps(inputs),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=EXECUTION_TIMEOUT
            )
        except asyncio.TimeoutError:
            proc.kill()
            raise TimeoutError(
                f"JavaScript execution timed out after {EXECUTION_TIMEOUT}s"
            )

        if proc.returncode != 0:
            raise RuntimeError(stderr.decode().strip())

        raw = stdout.decode().strip()
        return json.loads(raw) if raw else {}

    finally:
        os.unlink(tmp_path)


async def execute_code(
    code: str, language: str, inputs: Dict[str, Any]
) -> Dict[str, Any]:
    """Dispatch to the correct language executor."""
    lang = language.lower()
    if lang in ("python", "py"):
        return await execute_python(code, inputs)
    if lang in ("javascript", "js", "node"):
        return await execute_javascript(code, inputs)
    raise ValueError(f"Unsupported code language: {language}")
