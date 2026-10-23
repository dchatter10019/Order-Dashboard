from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass
from typing import Any


@dataclass
class CalculationResult:
    ok: bool
    payload: dict[str, Any] | None
    error: str | None
    timed_out: bool


def run_calculation_subprocess(
    *,
    tool_name: str,
    arguments: dict[str, Any],
    timeout_seconds: float,
    env: dict[str, str],
) -> CalculationResult:
    """Run analytics in an isolated worker process (no shell)."""
    payload = json.dumps({"tool": tool_name, "arguments": arguments}, separators=(",", ":"))
    cmd = [sys.executable, "-m", "bevvi_analytics_mcp.worker"]
    try:
        completed = subprocess.run(
            cmd,
            input=payload.encode("utf-8"),
            capture_output=True,
            timeout=timeout_seconds,
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return CalculationResult(ok=False, payload=None, error="calculation_timeout", timed_out=True)

    if completed.returncode != 0:
        err_text = completed.stderr.decode("utf-8", errors="replace").strip()
        try:
            err_doc = json.loads(completed.stdout.decode("utf-8") or err_text or "{}")
            message = err_doc.get("error") or err_text or "worker_failed"
        except json.JSONDecodeError:
            message = err_text or "worker_failed"
        return CalculationResult(ok=False, payload=None, error=message, timed_out=False)

    try:
        doc = json.loads(completed.stdout.decode("utf-8"))
    except json.JSONDecodeError:
        return CalculationResult(ok=False, payload=None, error="invalid_worker_output", timed_out=False)

    if not doc.get("ok"):
        return CalculationResult(ok=False, payload=None, error=str(doc.get("error") or "worker_error"), timed_out=False)
    result = doc.get("result")
    if not isinstance(result, dict):
        return CalculationResult(ok=False, payload=None, error="invalid_worker_result", timed_out=False)
    return CalculationResult(ok=True, payload=result, error=None, timed_out=False)


def worker_env_from_settings(settings_env: dict[str, str]) -> dict[str, str]:
    base = dict(os.environ)
    base.update(settings_env)
    return base
