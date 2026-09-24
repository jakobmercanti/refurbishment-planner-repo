"""Public deployment boundary; programmer mutations are local-only."""

import os

from starlette.responses import JSONResponse


class DeploymentBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "").rstrip("/")
        method = scope.get("method", "GET")
        public = os.getenv("RENOVATION_FIT_PUBLIC", "false").lower() == "true"
        programmer = os.getenv("ENABLE_PROGRAMMER_TOOLS", "false").lower() == "true"
        privileged = (path == "/settings" or path.startswith("/catalog/")) and method not in {"GET", "HEAD", "OPTIONS"}
        client = (scope.get("client") or ("", 0))[0]
        if privileged and (public or not programmer or client not in {"127.0.0.1", "::1", "testclient"}):
            return await JSONResponse({"detail": "Programmer tools are unavailable."}, status_code=403)(scope, receive, send)
        # Prototype process-local sessions and CAD are excluded from the public API.
        if public and (path == "/projects" or path.startswith("/projects/") or path == "/rooms" or (path.startswith("/rooms/") and path != "/rooms/validate") or path.startswith("/cad/") or path.startswith("/fit-checks/")):
            return await JSONResponse({"detail": "Not found"}, status_code=404)(scope, receive, send)
        return await self.app(scope, receive, send)
