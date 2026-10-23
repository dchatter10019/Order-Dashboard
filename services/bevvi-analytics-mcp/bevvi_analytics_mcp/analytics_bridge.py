from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any, Callable

CallToolFn = Callable[[str, dict[str, Any]], dict[str, Any]]
ValidateFn = Callable[[str, dict[str, Any]], None]


def load_handler_module(
    *,
    analytics_src: Path | None,
    use_synthetic: bool,
) -> tuple[CallToolFn, ValidateFn | None]:
    if use_synthetic:
        from bevvi_analytics_mcp.synthetic import analysis_tools as synthetic

        return synthetic.call_tool, synthetic.validate_arguments

    if analytics_src is None:
        raise RuntimeError(
            "BEVVI_ANALYTICS_SRC is required when BEVVI_ANALYTICS_MCP_SYNTHETIC is not enabled"
        )

    src = analytics_src.resolve()
    if not (src / "review_tools").is_dir():
        raise RuntimeError(f"analytics source missing review_tools package: {src}")

    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

    mod = importlib.import_module("review_tools.analysis_tools")
    call_tool = getattr(mod, "call_tool", None)
    validate_arguments = getattr(mod, "validate_arguments", None)
    if call_tool is None:
        raise RuntimeError("review_tools.analysis_tools.call_tool not found")
    return call_tool, validate_arguments
