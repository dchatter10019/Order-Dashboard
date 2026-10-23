from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import httpx2
import pytest
from mcp.client.client import Client
from mcp.client.streamable_http import streamable_http_client
from ml.planning_io import PlanningInputError
from review_tools.analysis_tools import call_tool

from acceptance_constants import ACCEPTANCE_AS_OF


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.mark.asyncio
async def test_snapshot_not_mutated(running_server, access_token, base_env):
    snapshot = Path(base_env["BEVVI_ANALYTICS_MCP_ROOT"])
    marker = snapshot / ".generation"
    before = _digest(marker)

    url = running_server["analytics_url"]
    http_client = httpx2.AsyncClient(headers={"Authorization": f"Bearer {access_token}"})
    transport = streamable_http_client(url, http_client=http_client)
    async with Client(transport) as client:
        await client.call_tool("bevvi_analysis_data_quality", {"as_of": ACCEPTANCE_AS_OF})

    assert _digest(marker) == before


@pytest.mark.asyncio
async def test_invalid_arguments_fail_closed(running_server, access_token):
    url = running_server["analytics_url"]
    http_client = httpx2.AsyncClient(headers={"Authorization": f"Bearer {access_token}"})
    transport = streamable_http_client(url, http_client=http_client)
    async with Client(transport) as client:
        result = await client.call_tool("bevvi_period_comparison", {"as_of": "not-a-date"})
    assert result.is_error
    body = json.loads(result.content[0].text)
    assert "error" in body


def test_missing_snapshot_fail_closed(base_env, monkeypatch):
    monkeypatch.setenv("BEVVI_ANALYTICS_MCP_ROOT", "/tmp/bevvi-mcp-nonexistent-snapshot")
    monkeypatch.setenv("BEVVI_USE_XGBOOST", "0")
    with pytest.raises((PlanningInputError, FileNotFoundError, OSError)):
        call_tool("bevvi_analysis_data_quality", {"as_of": ACCEPTANCE_AS_OF})
