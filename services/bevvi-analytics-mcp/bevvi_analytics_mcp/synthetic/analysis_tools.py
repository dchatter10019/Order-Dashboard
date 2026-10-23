"""Synthetic review_tools.analysis_tools for isolated local verification (not production data)."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from bevvi_analytics_mcp.constants import ALLOWED_TOOLS, PLANNING_MODEL_ALLOWED

SPECS: dict[str, dict[str, Any]] = {}


def _load_specs(fixtures_root: Path, export_name: str = "Bevvi-Python-Tools-List-Export.json") -> None:
    global SPECS
    if SPECS:
        return
    export_path = fixtures_root / export_name
    doc = json.loads(export_path.read_text(encoding="utf-8"))
    for tool in doc.get("result", {}).get("tools") or []:
        name = tool.get("name")
        if name in ALLOWED_TOOLS:
            SPECS[name] = tool.get("inputSchema") or {}


def validate_arguments(name: str, arguments: dict[str, Any]) -> None:
    fixtures_root = Path(os.environ["BEVVI_ANALYTICS_FIXTURES_ROOT"]).resolve()
    _load_specs(fixtures_root)
    schema = SPECS.get(name)
    if schema is None:
        raise ValueError(f"unknown tool: {name}")
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(arguments), key=lambda e: e.path)
    if errors:
        raise ValueError(errors[0].message)


def _fixture_payload(fixtures_root: Path, operation: str) -> dict[str, Any]:
    path = fixtures_root / f"{operation}.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Mirror production handler shape using review fixtures (volatile fields excluded in parity tests)."""
    fixtures_root = Path(os.environ["BEVVI_ANALYTICS_FIXTURES_ROOT"]).resolve()
    _load_specs(fixtures_root)
    validate_arguments(name, arguments)

    if name not in ALLOWED_TOOLS:
        raise ValueError(f"tool not allowed: {name}")

    if name == "bevvi_planning_forecast":
        model = arguments.get("model", PLANNING_MODEL_ALLOWED)
        if model != PLANNING_MODEL_ALLOWED:
            raise ValueError(f"model not allowed for this release: {model}")

    inject_sleep = float(os.environ.get("BEVVI_ANALYTICS_MCP_INJECT_SLEEP_SEC", "0") or "0")
    if inject_sleep > 0:
        time.sleep(inject_sleep)

    snapshot_root = Path(os.environ.get("BEVVI_ANALYTICS_MCP_SNAPSHOT_ROOT", ".")).resolve()
    if not snapshot_root.is_dir():
        raise RuntimeError("stale_or_missing_snapshot")

    # Fail closed on path tricks (synthetic guard; real handler is stricter).
    for value in arguments.values():
        if isinstance(value, str) and (".." in value or value.startswith("/etc")):
            raise ValueError("unsafe path rejected")

    fixture = _fixture_payload(fixtures_root, name)
    code_hash = os.environ.get(
        "BEVVI_ANALYTICS_SYNTHETIC_CODE_SHA256",
        "8a8539119267a0ebbea7d44d62d09a32c5abda2a82b0f69bf22e9098ffcce9a4",
    )
    as_of = arguments.get("as_of", "1970-01-01")
    base: dict[str, Any] = {
        "status": "review_only",
        "review_only": True,
        "production_ready": False,
        "writes_performed": False,
        "live_gate_status": "OFF",
        "financial_certification": "not_certified",
        "generated_at_utc": "1970-01-01T00:00:00Z",
        "analysis_source_sha256": code_hash,
        "provenance": {
            "live_gate_status": "OFF",
            "phase1_active": True,
            "analysis_source_sha256": code_hash,
            "input_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "business_timezone": "America/New_York",
            "as_of": as_of,
            "settled_through": as_of,
            "newest_cache_refresh_at_utc": "1970-01-01T00:00:00Z",
            "cache_age_hours": 1,
            "analysis_contract": "exact_v3",
            "known_limitations": ["Synthetic fixture — not certified"],
        },
    }

    if name == "bevvi_analysis_data_quality":
        return {**base, "eligible_orders": fixture.get("eligible_orders", 100), **fixture}
    if name == "bevvi_planning_forecast":
        return {
            **base,
            "horizons": fixture.get("horizons") or {"30": {}, "60": {}, "90": {}},
            "nonoverlapping_30_day_blocks": fixture.get("nonoverlapping_30_day_blocks") or [],
            "weekly": fixture.get("weekly") or [],
            "monthly": fixture.get("monthly") or [],
        }
    if name == "bevvi_period_comparison":
        return {
            **base,
            "current_period": fixture.get("current_period")
            or {"start_date": arguments["start_date"], "end_date": arguments["end_date"]},
            "baseline_period": fixture.get("baseline_period") or {},
            "metrics": fixture.get("metrics") or {"revenue_delta_pct": 0.1},
            "breakdown": fixture.get("breakdown") or [],
            "revenue_change_bridge": fixture.get("revenue_change_bridge") or {"items": []},
        }
    if name == "bevvi_customer_trends":
        return {
            **base,
            "customers": fixture.get("customers") or [],
            "unattributed": fixture.get("unattributed") or {"orders": 0},
            "metadata": fixture.get("metadata") or {"row_count": 0},
        }
    return base
