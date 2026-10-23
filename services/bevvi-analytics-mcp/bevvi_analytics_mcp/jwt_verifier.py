from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import jwt
from jwt import PyJWK, PyJWKSet
from mcp.server.auth.provider import AccessToken

from bevvi_analytics_mcp.constants import REQUIRED_SCOPE


class JwtTokenVerifier:
    """Validate externally issued OAuth access tokens (JWT) for this resource server."""

    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        algorithms: tuple[str, ...],
        jwks_path: Path | None,
        allowed_subjects: frozenset[str] | None,
    ) -> None:
        self.issuer = issuer.rstrip("/")
        self.audience = audience.rstrip("/")
        self.algorithms = algorithms
        self.allowed_subjects = allowed_subjects
        self._jwks: PyJWKSet | None = None
        if jwks_path is not None:
            self._jwks = PyJWKSet.from_json(jwks_path.read_text(encoding="utf-8"))

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")
            if self._jwks is None:
                return None
            jwk = self._pick_key(kid)
            if jwk is None:
                return None
            claims = jwt.decode(
                token,
                jwk.key,
                algorithms=list(self.algorithms),
                audience=self.audience,
                issuer=self.issuer,
                options={"require": ["exp", "sub"]},
            )
        except jwt.PyJWTError:
            return None

        if claims.get("token_use") == "id" or claims.get("typ") == "ID":
            return None

        scopes = _scopes_from_claims(claims)
        if REQUIRED_SCOPE not in scopes:
            return None

        subject = str(claims.get("sub") or "")
        if self.allowed_subjects is not None and subject not in self.allowed_subjects:
            return None

        client_id = str(claims.get("client_id") or claims.get("azp") or subject)
        exp = claims.get("exp")
        expires_at = int(exp) if exp is not None else None
        resource = claims.get("resource") or self.audience

        return AccessToken(
            token=token,
            client_id=client_id,
            scopes=scopes,
            expires_at=expires_at,
            resource=str(resource) if resource else None,
            subject=subject or None,
            claims={"iss": claims.get("iss"), "sub": subject},
        )

    def _pick_key(self, kid: str | None) -> PyJWK | None:
        assert self._jwks is not None
        if kid:
            try:
                return self._jwks[kid]
            except KeyError:
                pass
        # Single-key JWKS (local tests)
        keys = list(self._jwks.keys)
        if len(keys) == 1:
            return keys[0]
        return None


def _scopes_from_claims(claims: dict[str, Any]) -> list[str]:
    scope = claims.get("scope") or claims.get("scp") or ""
    if isinstance(scope, list):
        return [str(s) for s in scope]
    return [s for s in str(scope).split() if s]


def mint_test_access_token(
    *,
    private_key_pem: str,
    issuer: str,
    audience: str,
    subject: str,
    kid: str = "test-key",
    ttl_seconds: int = 300,
    scopes: list[str] | None = None,
    skew_seconds: int = 0,
) -> str:
    """Issue a signed JWT for isolated local verification only."""
    now = int(time.time()) + skew_seconds
    payload = {
        "iss": issuer.rstrip("/"),
        "sub": subject,
        "aud": audience.rstrip("/"),
        "exp": now + ttl_seconds,
        "iat": now,
        "scope": " ".join(scopes or [REQUIRED_SCOPE]),
        "client_id": "bevvi-mcp-test-client",
        "resource": audience.rstrip("/"),
    }
    return jwt.encode(payload, private_key_pem, algorithm="RS256", headers={"kid": kid})

