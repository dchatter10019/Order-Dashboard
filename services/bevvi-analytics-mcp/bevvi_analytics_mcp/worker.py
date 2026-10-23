"""Subprocess worker entry: stdin JSON request, stdout JSON response."""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from typing import Any

from bevvi_analytics_mcp.analytics_bridge import load_handler_module
from bevvi_analytics_mcp.config import Settings


def _emit(ok: bool, *, result: dict[str, Any] | None = None, error: str | None = None, code: int = 0) -> None:
    doc = {"ok": ok, "result": result, "error": error}
    sys.stdout.write(json.dumps(doc, separators=(",", ":")))
    sys.stdout.flush()
    raise SystemExit(code)


def main() -> None:
    settings = Settings.from_env()
    raw = sys.stdin.read()
    if not raw.strip():
        _emit(False, error="empty_request", code=2)
    try:
        req = json.loads(raw)
    except json.JSONDecodeError:
        _emit(False, error="invalid_json", code=2)

    tool = req.get("tool")
    arguments = req.get("arguments")
    if not isinstance(tool, str) or not isinstance(arguments, dict):
        _emit(False, error="invalid_request_shape", code=2)

    call_tool, validate = load_handler_module(
        analytics_src=settings.analytics_src,
        use_synthetic=settings.use_synthetic_handler,
    )
    try:
        sleep_sec = float(os.environ.get("BEVVI_ANALYTICS_MCP_WORKER_TEST_SLEEP_SEC", "0") or "0")
        if sleep_sec > 0:
            time.sleep(sleep_sec)
        if validate is not None:
            validate(tool, arguments)
        result = call_tool(tool, arguments)
    except Exception as exc:  # noqa: BLE001 — worker boundary
        _emit(False, error=str(exc), code=1)

    if not isinstance(result, dict):
        _emit(False, error="handler_returned_non_object", code=1)
    _emit(True, result=result, code=0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        _emit(False, error="worker_crash", code=1)
