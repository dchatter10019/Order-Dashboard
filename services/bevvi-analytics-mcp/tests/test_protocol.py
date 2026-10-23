from __future__ import annotations

import json

import httpx2
import pytest
from mcp.client.client import Client
from mcp.client.streamable_http import streamable_http_client

from bevvi_analytics_mcp.constants import ALLOWED_TOOLS

from acceptance_constants import ACCEPTANCE_AS_OF


def _tool_text(result) -> dict:
    text = result.content[0].text if result.content else None
    assert text
    return json.loads(text)


@pytest.mark.asyncio
async def test_mcp_initialize_list_and_call(running_server, access_token):
    url = running_server["analytics_url"]
    http_client = httpx2.AsyncClient(headers={"Authorization": f"Bearer {access_token}"})
    transport = streamable_http_client(url, http_client=http_client)
    async with Client(transport) as client:
        tools = await client.list_tools()
        names = {t.name for t in tools.tools}
        assert names == set(ALLOWED_TOOLS)
        assert "bevvi_historical_seasonality" not in names

        result = await client.call_tool("bevvi_analysis_data_quality", {"as_of": ACCEPTANCE_AS_OF})
        payload = _tool_text(result)
        assert payload.get("review_only") is True
        assert payload.get("status") == "review_only"
