from __future__ import annotations

import httpx
import pytest

from bevvi_analytics_mcp.jwt_verifier import JwtTokenVerifier, mint_test_access_token


@pytest.mark.asyncio
async def test_missing_token_returns_401(running_server):
    url = running_server["analytics_url"]
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert resp.status_code == 401
    assert "www-authenticate" in resp.headers
    assert "resource_metadata" in resp.headers["www-authenticate"]


@pytest.mark.asyncio
async def test_bad_signature_rejected(test_keypair, running_server, base_env):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_pem = other.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    bad = mint_test_access_token(
        private_key_pem=other_pem,
        issuer=base_env["BEVVI_ANALYTICS_MCP_ISSUER_URL"],
        audience=running_server["analytics_url"],
        subject="approved-analyst",
    )
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            running_server["analytics_url"],
            headers={"Authorization": f"Bearer {bad}"},
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_expired_token_rejected(test_keypair, running_server, base_env):
    private_pem, _ = test_keypair
    expired = mint_test_access_token(
        private_key_pem=private_pem,
        issuer=base_env["BEVVI_ANALYTICS_MCP_ISSUER_URL"],
        audience=running_server["analytics_url"],
        subject="approved-analyst",
        ttl_seconds=-10,
    )
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            running_server["analytics_url"],
            headers={"Authorization": f"Bearer {expired}"},
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_wrong_audience_rejected(test_keypair, running_server, base_env):
    private_pem, _ = test_keypair
    token = mint_test_access_token(
        private_key_pem=private_pem,
        issuer=base_env["BEVVI_ANALYTICS_MCP_ISSUER_URL"],
        audience="https://other.example/api",
        subject="approved-analyst",
    )
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            running_server["analytics_url"],
            headers={"Authorization": f"Bearer {token}"},
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_missing_scope_rejected(test_keypair, running_server, base_env):
    private_pem, _ = test_keypair
    token = mint_test_access_token(
        private_key_pem=private_pem,
        issuer=base_env["BEVVI_ANALYTICS_MCP_ISSUER_URL"],
        audience=running_server["analytics_url"],
        subject="approved-analyst",
        scopes=["openid"],
    )
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            running_server["analytics_url"],
            headers={"Authorization": f"Bearer {token}"},
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_unauthorized_subject_rejected(test_keypair, running_server, base_env):
    private_pem, jwks_path = test_keypair
    token = mint_test_access_token(
        private_key_pem=private_pem,
        issuer=base_env["BEVVI_ANALYTICS_MCP_ISSUER_URL"],
        audience=running_server["analytics_url"],
        subject="not-on-allowlist",
    )
    verifier = JwtTokenVerifier(
        issuer=base_env["BEVVI_ANALYTICS_MCP_ISSUER_URL"],
        audience=running_server["analytics_url"],
        algorithms=("RS256",),
        jwks_path=jwks_path,
        allowed_subjects=frozenset({"approved-analyst"}),
    )
    assert await verifier.verify_token(token) is None


@pytest.mark.asyncio
async def test_protected_resource_metadata(running_server):
    meta_url = running_server["base_url"] + "/.well-known/oauth-protected-resource/analytics"
    async with httpx.AsyncClient() as client:
        resp = await client.get(meta_url)
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("resource") == running_server["analytics_url"]
