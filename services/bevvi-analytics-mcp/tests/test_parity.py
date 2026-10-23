from __future__ import annotations

import json

import httpx2
import pytest
from mcp.client.client import Client
from mcp.client.streamable_http import streamable_http_client
from review_tools.analysis_tools import call_tool as direct_call_tool

from acceptance_constants import ACCEPTANCE_AS_OF


@pytest.mark.asyncio
async def test_direct_handler_matches_http(running_server, access_token, base_env):
    import os

    os.environ.update(base_env)
    direct = direct_call_tool("bevvi_analysis_data_quality", {"as_of": ACCEPTANCE_AS_OF})

    url = running_server["analytics_url"]
    http_client = httpx2.AsyncClient(headers={"Authorization": f"Bearer {access_token}"})
    transport = streamable_http_client(url, http_client=http_client)
    async with Client(transport) as mcp_client:
        http_result = await mcp_client.call_tool(
            "bevvi_analysis_data_quality", {"as_of": ACCEPTANCE_AS_OF}
        )
    http_payload = json.loads(http_result.content[0].text)

    def strip_volatile(doc: dict) -> dict:
        out = dict(doc)
        out.pop("generated_at_utc", None)
        prov = out.get("provenance")
        if isinstance(prov, dict):
            prov = dict(prov)
            prov.pop("newest_cache_refresh_at_utc", None)
            out["provenance"] = prov
        return out

    assert strip_volatile(direct) == strip_volatile(http_payload)
