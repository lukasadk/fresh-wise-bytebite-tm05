"""Abuse protection for a publicly-reachable deployment.

Both layers are OFF by default (empty key / limit 0), so local development
behaves exactly as before. They only switch on when the corresponding values
are set in the environment -- which is what a public deployment does.

What this is and is NOT:

  * The shared API key stops casual scanning, bots and drive-by traffic. It is
    NOT real authentication. The key ships inside the mobile app bundle, and
    anyone willing to unpack the app can read it. Treat it as a lock on the
    front door, not as proof of who is knocking.
  * Rate limiting is per-IP and in-process. Fine for one container; if the API
    is ever scaled to several replicas each gets its own counter, and it would
    need moving to Redis.

Neither layer introduces accounts, credentials or personal data, so the no-PII
design in database-schema-no-pii.md is unaffected.
"""
import secrets
import time
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# Reachable without the API key: the health probe (platforms and uptime checks
# hit it) and CORS preflight, which browsers send without custom headers.
PUBLIC_PATHS = {"/health"}


def client_ip(request: Request, trust_proxy: bool) -> str:
    """Best-effort caller IP.

    Behind a proxy the socket peer is the proxy itself, so every caller would
    share one bucket -- hence X-Forwarded-For. But a client can *send* that
    header too, so honouring it when NOT behind a proxy hands anyone a trivial
    way to evade the limit by rotating a fake value. Only enable
    TRUST_PROXY_HEADERS when something trusted really is in front.
    """
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class ApiKeyMiddleware(BaseHTTPMiddleware):
    """Rejects anything without the shared key. No-op when no key is configured."""

    def __init__(self, app, api_key: str, header_name: str = "X-API-Key"):
        super().__init__(app)
        self.api_key = api_key
        self.header_name = header_name

    async def dispatch(self, request: Request, call_next):
        if not self.api_key or request.method == "OPTIONS" or request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        presented = request.headers.get(self.header_name, "")
        # compare_digest rather than == so a wrong key can't be recovered by
        # timing how long the comparison takes.
        if not secrets.compare_digest(presented, self.api_key):
            return JSONResponse(
                status_code=401,
                content={"detail": f"Missing or invalid '{self.header_name}' header."},
            )
        return await call_next(request)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window per-IP limit. No-op when limit is 0."""

    def __init__(self, app, limit_per_minute: int, trust_proxy: bool = False):
        super().__init__(app)
        self.limit = limit_per_minute
        self.trust_proxy = trust_proxy
        self._hits: dict[str, deque] = {}
        self._last_sweep = time.monotonic()

    def _sweep(self, now: float) -> None:
        """Drop idle IPs so the dict can't grow without bound under a spray of
        one-request-per-address traffic."""
        if now - self._last_sweep < 60:
            return
        cutoff = now - 60
        for ip in [ip for ip, hits in self._hits.items() if not hits or hits[-1] <= cutoff]:
            del self._hits[ip]
        self._last_sweep = now

    async def dispatch(self, request: Request, call_next):
        if self.limit <= 0 or request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        now = time.monotonic()
        self._sweep(now)
        cutoff = now - 60

        ip = client_ip(request, self.trust_proxy)
        hits = self._hits.setdefault(ip, deque())
        while hits and hits[0] <= cutoff:
            hits.popleft()

        if len(hits) >= self.limit:
            retry_after = max(1, int(60 - (now - hits[0])))
            return JSONResponse(
                status_code=429,
                content={"detail": f"Rate limit exceeded ({self.limit}/min). Try again shortly."},
                headers={"Retry-After": str(retry_after)},
            )

        hits.append(now)
        return await call_next(request)
