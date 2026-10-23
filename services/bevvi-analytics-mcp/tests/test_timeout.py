from __future__ import annotations

import json
import os

import httpx2
import pytest
from mcp.client.client import Client
from mcp.client.streamable_http import streamable_http_client


@pytest.mark.asyncio
async def test_calculation_timeout(running_server, access_token, base_env):
    old = os.environ.get("BEVVI_ANALYTICS_MCP_WORKER_TEST_SLEEP_SEC")
    os.environ["BEVVI_ANALYTICS_MCP_WORKER_TEST_SLEEP_SEC"] = "5"
    os.environ["BEVVI_ANALYTICS_MCP_CALC_TIMEOUT_SEC"] = "1"
    try:
        url = running_server["analytics_url"]
        http_client = httpx2.AsyncClient(
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30.0,
        )
        transport = streamable_http_client(url, http_client=http_client)
        async with Client(transport) as client:
            from acceptance_constants import ACCEPTANCE_AS_OF

            result = await client.call_tool("bevvi_analysis_data_quality", {"as_of": ACCEPTANCE_AS_OF})
        assert result.is_error
        body = json.loads(result.content[0].text)
        assert body.get("timed_out") is True
    finally:
        if old is None:
            os.environ.pop("BEVVI_ANALYTICS_MCP_WORKER_TEST_SLEEP_SEC", None)
        else:
            os.environ["BEVVI_ANALYTICS_MCP_WORKER_TEST_SLEEP_SEC"] = old
        os.environ["BEVVI_ANALYTICS_MCP_CALC_TIMEOUT_SEC"] = base_env["BEVVI_ANALYTICS_MCP_CALC_TIMEOUT_SEC"]
