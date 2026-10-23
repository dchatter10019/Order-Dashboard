from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from typing import Any

import mcp_types as types
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
from mcp.server.auth.settings import AuthSettings
from mcp.server.context import ServerRequestContext
from mcp.server.lowlevel.server import Server
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import AnyHttpUrl
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.routing import Route

from bevvi_analytics_mcp.admission import CalculationAdmission
from bevvi_analytics_mcp.analytics_bridge import load_handler_module
from bevvi_analytics_mcp.config import Settings
from bevvi_analytics_mcp.constants import ALLOWED_TOOLS, PLANNING_MODEL_ALLOWED, REQUIRED_SCOPE
from bevvi_analytics_mcp.jwt_verifier import JwtTokenVerifier
from bevvi_analytics_mcp.request_log import log_tool_outcome, new_request_id
from bevvi_analytics_mcp.subprocess_runner import run_calculation_subprocess, worker_env_from_settings
from bevvi_analytics_mcp.tools_catalog import load_tools_from_export


def _volatile_strip(doc: dict[str, Any]) -> dict[str, Any]:
    out = dict(doc)
    out.pop("generated_at_utc", None)
    prov = out.get("provenance")
    if isinstance(prov, dict):
        prov = dict(prov)
        prov.pop("newest_cache_refresh_at_utc", None)
        out["provenance"] = prov
    return out


def build_starlette_app(settings: Settings | None = None) -> Starlette:
    settings = settings or Settings.from_env()
    export_path = settings.fixtures_root / "Bevvi-Python-Tools-List-Export.json"
    tools = load_tools_from_export(export_path)
    admission = CalculationAdmission(settings.max_concurrent_calculations)

    def build_worker_env() -> dict[str, str]:
        pythonpath_parts = [str(settings.pythonpath_root)]
        if settings.analytics_src:
            pythonpath_parts.insert(0, str(settings.analytics_src))
        base = {
            "BEVVI_ANALYTICS_MCP_SYNTHETIC": "1" if settings.use_synthetic_handler else "0",
            "BEVVI_ANALYTICS_MCP_SNAPSHOT_ROOT": str(settings.snapshot_root),
            "BEVVI_ANALYTICS_MCP_ROOT": str(settings.snapshot_root),
            "BEVVI_ANALYTICS_FIXTURES_ROOT": str(settings.fixtures_root),
            "BEVVI_ANALYTICS_SRC": str(settings.analytics_src) if settings.analytics_src else "",
            "BEVVI_ORDER_DASHBOARD_ROOT": str(settings.repo_root),
            "BEVVI_USE_XGBOOST": "0",
            "PYTHONPATH": os.pathsep.join(pythonpath_parts),
            "BEVVI_ANALYTICS_MCP_CALC_TIMEOUT_SEC": str(settings.calculation_timeout_seconds),
        }
        env = worker_env_from_settings(base)
        for key, value in os.environ.items():
            if key.startswith("BEVVI_") or key == "PYTHONPATH":
                env[key] = value
        return env

    # Direct handler for parity tests (same subprocess path used for HTTP calls).
    direct_call_tool, direct_validate = load_handler_module(
        analytics_src=settings.analytics_src,
        use_synthetic=settings.use_synthetic_handler,
    )

    @asynccontextmanager
    async def lifespan(_server: Server[Any]):
        yield {"settings": settings}

    async def on_list_tools(
        _ctx: ServerRequestContext[Any], _params: types.PaginatedRequestParams | None
    ) -> types.ListToolsResult:
        return types.ListToolsResult(tools=tools)

    async def on_call_tool(
        ctx: ServerRequestContext[Any], params: types.CallToolRequestParams
    ) -> types.CallToolResult:
        name = params.name
        arguments = dict(params.arguments or {})
        request_id = new_request_id()
        subject: str | None = None
        http_req = ctx.request
        if http_req is not None:
            user = http_req.scope.get("user")
            if isinstance(user, AuthenticatedUser):
                subject = user.access_token.subject

        started = time.perf_counter()
        if name not in ALLOWED_TOOLS:
            log_tool_outcome(
                request_id=request_id,
                subject=subject,
                tool=name,
                duration_ms=(time.perf_counter() - started) * 1000,
                outcome="rejected",
                detail="tool_not_allowed",
            )
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=json.dumps({"error": "tool_not_allowed"}))],
                isError=True,
            )

        if name == "bevvi_planning_forecast":
            model = arguments.get("model", PLANNING_MODEL_ALLOWED)
            if model != PLANNING_MODEL_ALLOWED:
                log_tool_outcome(
                    request_id=request_id,
                    subject=subject,
                    tool=name,
                    duration_ms=(time.perf_counter() - started) * 1000,
                    outcome="rejected",
                    detail="model_not_allowed",
                )
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=json.dumps({"error": "model_not_allowed"}))],
                    isError=True,
                )

        await admission.acquire()
        try:
            timeout_seconds = float(
                os.environ.get("BEVVI_ANALYTICS_MCP_CALC_TIMEOUT_SEC", settings.calculation_timeout_seconds)
            )
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None,
                lambda: run_calculation_subprocess(
                    tool_name=name,
                    arguments=arguments,
                    timeout_seconds=timeout_seconds,
                    env=build_worker_env(),
                ),
            )
        finally:
            admission.release()

        duration_ms = (time.perf_counter() - started) * 1000
        if not result.ok:
            log_tool_outcome(
                request_id=request_id,
                subject=subject,
                tool=name,
                duration_ms=duration_ms,
                outcome="error",
                detail=result.error or "unknown",
            )
            return types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=json.dumps({"error": result.error, "timed_out": result.timed_out}),
                    )
                ],
                isError=True,
            )

        assert result.payload is not None
        encoded = json.dumps(result.payload, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > settings.max_result_bytes:
            log_tool_outcome(
                request_id=request_id,
                subject=subject,
                tool=name,
                duration_ms=duration_ms,
                outcome="rejected",
                detail="result_too_large",
            )
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=json.dumps({"error": "result_too_large"}))],
                isError=True,
            )

        log_tool_outcome(
            request_id=request_id,
            subject=subject,
            tool=name,
            duration_ms=duration_ms,
            outcome="ok",
        )
        return types.CallToolResult(content=[types.TextContent(type="text", text=encoded)])

    mcp_server = Server(
        "bevvi-analytics-mcp",
        version="0.1.0",
        instructions="Read-only Bevvi analytics (four tools). OAuth required.",
        lifespan=lifespan,
        on_list_tools=on_list_tools,
        on_call_tool=on_call_tool,
    )

    transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[f"{settings.host}:*", "localhost:*", "127.0.0.1:*", "[::1]:*"],
        allowed_origins=[
            f"http://{settings.host}:*",
            "http://127.0.0.1:*",
            "http://localhost:*",
        ],
    )

    token_verifier: JwtTokenVerifier | None = None
    if settings.jwks_path is not None:
        token_verifier = JwtTokenVerifier(
            issuer=settings.issuer_url,
            audience=settings.jwt_audience,
            algorithms=settings.jwt_algorithms,
            jwks_path=settings.jwks_path,
            allowed_subjects=settings.allowed_subjects,
        )

    auth_settings = AuthSettings(
        issuer_url=AnyHttpUrl(settings.issuer_url + "/"),
        resource_server_url=AnyHttpUrl(settings.resource_server_url),
        required_scopes=[REQUIRED_SCOPE],
        validate_token_resource=True,
    )

    app = mcp_server.streamable_http_app(
        streamable_http_path=settings.streamable_http_path,
        stateless_http=True,
        json_response=True,
        host=settings.host,
        transport_security=transport_security,
        auth=auth_settings,
        token_verifier=token_verifier,
    )

    async def health(_request: Request) -> PlainTextResponse:
        return PlainTextResponse("ok", status_code=200)

    async def direct_handler_call(request: Request) -> JSONResponse:
        """Test-only parity helper (not exposed in production nginx)."""
        if not settings.use_synthetic_handler:
            return JSONResponse({"error": "disabled"}, status_code=404)
        body = await request.json()
        name = body.get("name")
        arguments = body.get("arguments") or {}
        if not isinstance(name, str) or not isinstance(arguments, dict):
            return JSONResponse({"error": "invalid"}, status_code=400)
        if direct_validate:
            direct_validate(name, arguments)
        result = direct_call_tool(name, arguments)
        return JSONResponse(result)

    # Attach health + parity routes without replacing MCP lifespan app.
    app.routes.insert(0, Route("/healthz", endpoint=health, methods=["GET"]))
    app.routes.insert(0, Route("/_test/direct-call", endpoint=direct_handler_call, methods=["POST"]))

    # Expose parity helpers on app state for tests.
    app.state.settings = settings
    app.state.direct_call_tool = direct_call_tool
    app.state.direct_validate = direct_validate
    app.state.volatile_strip = _volatile_strip

    return app
