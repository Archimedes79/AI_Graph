"""
Regression tests for the Code Node execution sandbox (or lack thereof).

`app.services.code_executor.execute_javascript` runs user-supplied code in a
plain subprocess with only a wall-clock timeout and a scrubbed environment: no
filesystem jail and no CPU/memory limits, so a Code Node can still spawn further
processes or make network calls, and can read any file the backend process user
can read.

The filesystem-sandbox test below asserts the *secure* behaviour we want once a
real jail (container/chroot) is implemented. It is expected to FAIL today and is
marked `xfail` so it doesn't break CI; once a fix lands, remove the `xfail`
marker.

Written in JavaScript because that is the only language a code node runs. The
same three properties were tested against the Python executor before it was
removed, and they matter identically here: a body Node runs is a body a model
wrote.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.code_executor import execute_javascript  # noqa: E402


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
        "import { readFileSync } from 'node:fs';\n"
        "function run(inputs) {\n"
        "  return { leaked: readFileSync(inputs.path, 'utf8') };\n"
        "}\n"
    )

    result = await execute_javascript(code, {"path": str(secret_file)})

    # Secure expectation: arbitrary filesystem reads should be blocked.
    assert "top-secret-value-12345" not in result.get("leaked", "")


@pytest.mark.asyncio
async def test_code_node_cannot_read_backend_secrets(monkeypatch):
    """A Code Node must not have access to the backend's secret env vars."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-super-secret-value")

    code = (
        "function run(inputs) {\n"
        "  return { leaked_key: process.env.OPENAI_API_KEY ?? '' };\n"
        "}\n"
    )

    result = await execute_javascript(code, {})

    # Secure expectation: the sandbox should not expose backend secrets.
    assert result.get("leaked_key", "") == ""


@pytest.mark.asyncio
async def test_an_async_body_is_awaited_rather_than_serialised_as_a_promise():
    """
    `async function run` is what a model writes the moment a description
    mentions a file, a fetch or a timer. An un-awaited promise serialises to
    `{}`, which the verification pass then reports as "returned nothing" and
    tries to repair -- turning working code into worse code.
    """
    code = (
        "async function run(inputs) {\n"
        "  await new Promise((done) => setTimeout(done, 10));\n"
        "  return { answer: inputs.n * 2 };\n"
        "}\n"
    )

    assert await execute_javascript(code, {"n": 21}) == {"answer": 42}


@pytest.mark.asyncio
async def test_cancelling_a_code_node_kills_its_subprocess(tmp_path):
    """
    Stop must end the work, not just stop watching it.

    `asyncio.to_thread` cannot be interrupted, so cancelling the await used to
    leave the child process running to completion unseen -- the UI was freed
    while the machine kept working. The node writes a marker only after its
    sleep; if the process really died, the marker never appears.
    """
    import asyncio
    from app.services import code_executor

    marker = tmp_path / "finished.txt"
    code = (
        "import { writeFileSync } from 'node:fs';\n"
        "async function run(inputs) {\n"
        "  await new Promise((done) => setTimeout(done, 4000));\n"
        f"  writeFileSync({json.dumps(str(marker))}, 'finished');\n"
        "  return { ok: true };\n"
        "}\n"
    )

    task = asyncio.create_task(code_executor.execute_javascript(code, {}))
    await asyncio.sleep(1.0)  # let the interpreter actually start
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    # Well past the node's own sleep: if it had survived, the marker would exist.
    await asyncio.sleep(5.0)
    assert not marker.exists(), "the code node's subprocess outlived the cancelled run"
