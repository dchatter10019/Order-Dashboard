from __future__ import annotations

import logging
import uuid
from typing import Any

logger = logging.getLogger("bevvi_analytics_mcp.audit")


def new_request_id() -> str:
    return uuid.uuid4().hex


def log_tool_outcome(
    *,
    request_id: str,
    subject: str | None,
    tool: str,
    duration_ms: float,
    outcome: str,
    detail: str | None = None,
) -> None:
    """Structured audit log without tokens, row data, or full responses."""
    extra: dict[str, Any] = {
        "request_id": request_id,
        "subject": subject or "unknown",
        "tool": tool,
        "duration_ms": round(duration_ms, 2),
        "outcome": outcome,
    }
    if detail:
        extra["detail"] = detail
    logger.info("tool_call", extra=extra)
