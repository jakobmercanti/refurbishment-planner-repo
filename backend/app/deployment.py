"""Public deployment boundary; programmer mutations are local-only."""

import os
from urllib.parse import urlsplit

from starlette.responses import JSONResponse
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def public_deployment() -> bool:
    return os.getenv("RENOVATION_FIT_PUBLIC", "true").strip().lower() != "false"


def local_request(scope: Scope) -> bool:
    local = {"127.0.0.1", "::1", "localhost"}
    client = (scope.get("client") or ("", 0))[0]
    if client == "testclient":
        local |= {"testclient", "testserver"}
    if client not in local:
        return False
    headers = Headers(scope=scope)
    try:
        for host in (headers.get("host", ""), *headers.get("x-forwarded-host", "").split(",")):
            if host and urlsplit("//" + host.strip()).hostname not in local:
                return False
        origin = headers.get("origin")
        if origin and urlsplit(origin).hostname not in local:
            return False
    except ValueError:
        return False
    return not headers.get("forwarded") and all(
        not peer.strip() or peer.strip() in local for peer in headers.get("x-forwarded-for", "").split(",")
    )


class DeploymentBoundary:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "").rstrip("/")
        method = scope.get("method", "GET")
        public = public_deployment()
        programmer = os.getenv("ENABLE_PROGRAMMER_TOOLS", "false").lower() == "true"
        privileged = (path == "/settings" or path.startswith("/catalog/")) and method not in {"GET", "HEAD", "OPTIONS"}
        local = not public and local_request(scope)
        if privileged and (not local or not programmer):
            return await JSONResponse({"detail": "Programmer tools are unavailable."}, status_code=403)(
                scope, receive, send
            )
        # Prototype process-local sessions and CAD are excluded from the public API.
        if not local and (
            path == "/projects"
            or path.startswith("/projects/")
            or path == "/rooms"
            or (path.startswith("/rooms/") and path != "/rooms/validate")
            or path.startswith("/cad/")
            or path.startswith("/fit-checks/")
            or path in {"/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"}
        ):
            return await JSONResponse({"detail": "Not found"}, status_code=404)(scope, receive, send)
        async def send_private(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["Cache-Control"] = "private, no-store"
                headers["X-Content-Type-Options"] = "nosniff"
            await send(message)

        return await self.app(scope, receive, send_private if path.startswith("/commercial/") else send)
