"""
Regression tests for the Code Node execution sandbox (or lack thereof).

`app.services.code_executor.execute_python` / `execute_javascript` run
user-supplied code in a plain subprocess with only a wall-clock timeout
and a scrubbed environment: no filesystem jail and no CPU/memory limits,
so a Code Node can still spawn further processes or make network calls,
and can read any file the backend process user can read.

The filesystem-sandbox test below asserts the *secure* behaviour we want
once a real jail (container/chroot) is implemented. It is expected to
FAIL today and is marked `xfail` so it doesn't break CI; once a fix
lands, remove the `xfail` marker.
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
        "import time, pathlib\n"
        "def run(inputs):\n"
        "    time.sleep(4)\n"
        f"    pathlib.Path(r'{marker}').write_text('finished')\n"
        "    return {'ok': True}\n"
    )

    task = asyncio.create_task(code_executor.execute_python(code, {}))
    await asyncio.sleep(1.0)  # let the interpreter actually start
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    # Well past the node's own sleep: if it had survived, the marker would exist.
    await asyncio.sleep(5.0)
    assert not marker.exists(), "the code node's subprocess outlived the cancelled run"
