"""
Regression tests for the Code Node execution sandbox (or lack thereof).

`app.services.code_executor.execute_python` / `execute_javascript` run
user-supplied code in a plain subprocess with only a wall-clock timeout:
no filesystem jail, no environment scrubbing, no CPU/memory limits, and
no restriction on spawning further processes or making network calls.

These tests assert the *secure* behaviour we want once sandboxing is
implemented. They are expected to FAIL today because the vulnerability
is real, and are marked `xfail` so they don't break CI before a fix
lands. Once the fix lands, remove the `xfail` marker; if it starts
reporting XPASS, that's confirmation the mitigation works.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.code_executor import execute_python  # noqa: E402


@pytest.mark.asyncio
@pytest.mark.xfail(
    reason=(
        "code_executor has no filesystem sandbox: the subprocess runs with the "
        "same filesystem permissions as the backend process, so a Code Node can "
        "read any file the backend user can read (e.g. secrets, other users' "
        "data, source code outside the project)."
    ),
    strict=False,
)
async def test_code_node_cannot_read_arbitrary_filesystem_path(tmp_path):
    """A Code Node must not be able to read files outside its sandbox."""
    secret_file = tmp_path / "outside_sandbox_secret.txt"
    secret_file.write_text("top-secret-value-12345")

    code = (
        "def run(inputs):\n"
        "    with open(inputs['path'], 'r') as f:\n"
        "        return {'leaked': f.read()}\n"
    )

    result = await execute_python(code, {"path": str(secret_file)})

    # Secure expectation: arbitrary filesystem reads should be blocked.
    assert "top-secret-value-12345" not in result.get("leaked", "")


@pytest.mark.asyncio
@pytest.mark.xfail(
    reason=(
        "code_executor does not scrub the environment before spawning the "
        "subprocess (no `env=` passed to create_subprocess_exec), so a Code "
        "Node inherits the full backend process environment, including "
        "secrets such as OPENAI_API_KEY / ANTHROPIC_API_KEY."
    ),
    strict=False,
)
async def test_code_node_cannot_read_backend_secrets(monkeypatch):
    """A Code Node must not have access to the backend's secret env vars."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-super-secret-value")

    code = (
        "import os\n"
        "def run(inputs):\n"
        "    return {'leaked_key': os.environ.get('OPENAI_API_KEY', '')}\n"
    )

    result = await execute_python(code, {})

    # Secure expectation: the sandbox should not expose backend secrets.
    assert result.get("leaked_key", "") == ""
