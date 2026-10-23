from __future__ import annotations

import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from bevvi_analytics_mcp.app import build_starlette_app
from bevvi_analytics_mcp.config import Settings
from bevvi_analytics_mcp.constants import REVIEW_ANALYTICS_SOURCE_COMMIT
from bevvi_analytics_mcp.jwt_verifier import mint_test_access_token
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures"))
from acceptance_snapshot_builder import build_acceptance_snapshot  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
SERVICE_ROOT = Path(__file__).resolve().parents[1]
ANALYTICS_SRC = REPO_ROOT / "vendor" / "XGBoostForecast"
ACCEPTANCE_SNAPSHOT = SERVICE_ROOT / "tests/fixtures/acceptance_snapshot"
ISSUER = "https://auth.example.test"
def _free_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def _verify_analytics_source() -> None:
    if not (ANALYTICS_SRC / "review_tools" / "analysis_tools.py").is_file():
        raise RuntimeError(f"Missing analytics source at {ANALYTICS_SRC}")
    head = subprocess.check_output(
        ["git", "-C", str(ANALYTICS_SRC), "rev-parse", "HEAD"],
        text=True,
    ).strip()
    if head != REVIEW_ANALYTICS_SOURCE_COMMIT:
        raise RuntimeError(
            f"BEVVI_ANALYTICS_SRC commit mismatch: expected {REVIEW_ANALYTICS_SOURCE_COMMIT}, got {head}"
        )


@pytest.fixture(scope="session", autouse=True)
def _prepare_acceptance_snapshot():
    _verify_analytics_source()
    build_acceptance_snapshot(ACCEPTANCE_SNAPSHOT)


@pytest.fixture(scope="session")
def test_keypair(tmp_path_factory):
    base = tmp_path_factory.mktemp("keys")
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    jwk = json.loads(RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk["kid"] = "test-key"
    jwk["use"] = "sig"
    jwk["alg"] = "RS256"
    jwks_path = base / "jwks.json"
    jwks_path.write_text(json.dumps({"keys": [jwk]}), encoding="utf-8")
    return private_pem.decode("utf-8"), jwks_path


@pytest.fixture(scope="session")
def base_env(test_keypair) -> dict[str, str]:
    _, jwks_path = test_keypair
    pythonpath = os.pathsep.join([str(ANALYTICS_SRC), str(SERVICE_ROOT)])
    return {
        "BEVVI_ORDER_DASHBOARD_ROOT": str(REPO_ROOT),
        "BEVVI_ANALYTICS_SRC": str(ANALYTICS_SRC),
        "BEVVI_ANALYTICS_MCP_SYNTHETIC": "0",
        "BEVVI_ANALYTICS_MCP_ROOT": str(ACCEPTANCE_SNAPSHOT),
        "BEVVI_ANALYTICS_MCP_SNAPSHOT_ROOT": str(ACCEPTANCE_SNAPSHOT),
        "BEVVI_ANALYTICS_MCP_JWKS_PATH": str(jwks_path),
        "BEVVI_ANALYTICS_MCP_ISSUER_URL": ISSUER,
        "BEVVI_ANALYTICS_MCP_JWT_AUDIENCE": "http://127.0.0.1:8792/analytics",
        "BEVVI_ANALYTICS_MCP_RESOURCE_URL": "http://127.0.0.1:8792/analytics",
        "BEVVI_ANALYTICS_FIXTURES_ROOT": str(REPO_ROOT / "test-fixtures/analytics-gateway"),
        "BEVVI_ANALYTICS_MCP_ALLOWED_SUBJECTS": "approved-analyst",
        "BEVVI_ANALYTICS_MCP_CALC_TIMEOUT_SEC": "120",
        "BEVVI_USE_XGBOOST": "0",
        "PYTHONPATH": pythonpath,
    }


@pytest.fixture
def settings(base_env) -> Settings:
    old = dict(os.environ)
    os.environ.update(base_env)
    try:
        yield Settings.from_env()
    finally:
        os.environ.clear()
        os.environ.update(old)


@pytest.fixture
def access_token(test_keypair, running_server) -> str:
    private_pem, _ = test_keypair
    return mint_test_access_token(
        private_key_pem=private_pem,
        issuer=ISSUER,
        audience=running_server["analytics_url"],
        subject="approved-analyst",
    )


@pytest.fixture
def running_server(base_env):
    old = dict(os.environ)
    os.environ.update(base_env)
    port = _free_port()
    resource = f"http://127.0.0.1:{port}/analytics"
    os.environ["BEVVI_ANALYTICS_MCP_PORT"] = str(port)
    os.environ["BEVVI_ANALYTICS_MCP_RESOURCE_URL"] = resource
    os.environ["BEVVI_ANALYTICS_MCP_JWT_AUDIENCE"] = resource
    settings = Settings.from_env()
    app = build_starlette_app(settings)
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 15
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    if not server.started:
        raise RuntimeError("uvicorn failed to start")

    yield {"port": port, "base_url": f"http://127.0.0.1:{port}", "analytics_url": resource, "settings": settings}
    server.should_exit = True
    thread.join(timeout=5)
    os.environ.clear()
    os.environ.update(old)
