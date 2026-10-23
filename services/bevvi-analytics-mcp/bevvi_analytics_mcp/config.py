from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _repo_root() -> Path:
    env = os.environ.get("BEVVI_ORDER_DASHBOARD_ROOT")
    if env:
        return Path(env).resolve()
    # services/bevvi-analytics-mcp/bevvi_analytics_mcp/config.py -> repo root
    return Path(__file__).resolve().parents[3]


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    streamable_http_path: str
    resource_server_url: str
    issuer_url: str
    jwks_path: Path | None
    jwt_audience: str
    jwt_algorithms: tuple[str, ...]
    allowed_subjects: frozenset[str] | None
    snapshot_root: Path
    analytics_src: Path | None
    use_synthetic_handler: bool
    max_concurrent_calculations: int
    calculation_timeout_seconds: float
    max_result_bytes: int
    trusted_proxy_hops: int
    analytics_source_commit: str
    fixtures_root: Path
    repo_root: Path
    pythonpath_root: Path

    @classmethod
    def from_env(cls) -> Settings:
        root = _repo_root()
        pythonpath_root = Path(__file__).resolve().parents[1]
        resource = os.environ.get(
            "BEVVI_ANALYTICS_MCP_RESOURCE_URL", "http://127.0.0.1:8792/analytics"
        ).rstrip("/")
        issuer = os.environ.get("BEVVI_ANALYTICS_MCP_ISSUER_URL", "https://auth.example.test/").rstrip("/")
        jwks = os.environ.get("BEVVI_ANALYTICS_MCP_JWKS_PATH")
        audience = os.environ.get("BEVVI_ANALYTICS_MCP_JWT_AUDIENCE", resource)
        alg_raw = os.environ.get("BEVVI_ANALYTICS_MCP_JWT_ALGORITHMS", "RS256")
        subjects_raw = os.environ.get("BEVVI_ANALYTICS_MCP_ALLOWED_SUBJECTS", "")
        allowed_subjects = (
            frozenset(s.strip() for s in subjects_raw.split(",") if s.strip()) if subjects_raw else None
        )
        mcp_root = os.environ.get("BEVVI_ANALYTICS_MCP_ROOT") or os.environ.get(
            "BEVVI_ANALYTICS_MCP_SNAPSHOT_ROOT"
        )
        snapshot = Path(
            mcp_root
            or str(root / "services/bevvi-analytics-mcp/tests/fixtures/acceptance_snapshot")
        ).resolve()
        default_src = root / "vendor" / "XGBoostForecast"
        analytics_src = os.environ.get("BEVVI_ANALYTICS_SRC") or (
            str(default_src) if default_src.is_dir() else None
        )
        return cls(
            host=os.environ.get("BEVVI_ANALYTICS_MCP_HOST", "127.0.0.1"),
            port=int(os.environ.get("BEVVI_ANALYTICS_MCP_PORT", "8792")),
            streamable_http_path=os.environ.get("BEVVI_ANALYTICS_MCP_HTTP_PATH", "/analytics"),
            resource_server_url=resource,
            issuer_url=issuer,
            jwks_path=Path(jwks).resolve() if jwks else None,
            jwt_audience=audience,
            jwt_algorithms=tuple(a.strip() for a in alg_raw.split(",") if a.strip()),
            allowed_subjects=allowed_subjects,
            snapshot_root=snapshot,
            analytics_src=Path(analytics_src).resolve() if analytics_src else None,
            use_synthetic_handler=_bool("BEVVI_ANALYTICS_MCP_SYNTHETIC", False),
            max_concurrent_calculations=int(os.environ.get("BEVVI_ANALYTICS_MCP_MAX_CONCURRENT", "1")),
            calculation_timeout_seconds=float(os.environ.get("BEVVI_ANALYTICS_MCP_CALC_TIMEOUT_SEC", "120")),
            max_result_bytes=int(os.environ.get("BEVVI_ANALYTICS_MCP_MAX_RESULT_BYTES", str(2 * 1024 * 1024))),
            trusted_proxy_hops=int(os.environ.get("BEVVI_ANALYTICS_MCP_TRUSTED_PROXY_HOPS", "0")),
            analytics_source_commit=os.environ.get(
                "BEVVI_ANALYTICS_SOURCE_COMMIT",
                "a4e707f7b8d3251677f5cdfcb71d2ead5adf7514",
            ),
            fixtures_root=Path(
                os.environ.get(
                    "BEVVI_ANALYTICS_FIXTURES_ROOT",
                    str(root / "test-fixtures/analytics-gateway"),
                )
            ).resolve(),
            repo_root=root,
            pythonpath_root=pythonpath_root,
        )
