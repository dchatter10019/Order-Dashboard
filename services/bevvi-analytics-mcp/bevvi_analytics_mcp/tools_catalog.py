from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import mcp_types as types

from bevvi_analytics_mcp.constants import ALLOWED_TOOLS, PLANNING_MODEL_ALLOWED


def load_tools_from_export(export_path: Path) -> list[types.Tool]:
    doc = json.loads(export_path.read_text(encoding="utf-8"))
    raw_tools = doc.get("result", {}).get("tools") or doc.get("tools") or []
    out: list[types.Tool] = []
    for tool in raw_tools:
        name = tool.get("name")
        if name not in ALLOWED_TOOLS:
            continue
        schema = dict(tool.get("inputSchema") or {})
        if name == "bevvi_planning_forecast":
            schema = _restrict_planning_schema(schema)
        out.append(
            types.Tool(
                name=name,
                description=tool.get("description") or "",
                inputSchema=schema,
                annotations=tool.get("annotations"),
            )
        )
    missing = ALLOWED_TOOLS - {t.name for t in out}
    if missing:
        raise RuntimeError(f"Tools export missing required tools: {sorted(missing)}")
    return sorted(out, key=lambda t: t.name)


def _restrict_planning_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Expose only planning_blend_v1 for the initial EC2 release."""
    schema = json.loads(json.dumps(schema))
    props = schema.setdefault("properties", {})
    model = props.get("model") or {}
    model["enum"] = [PLANNING_MODEL_ALLOWED]
    props["model"] = model
    return schema
