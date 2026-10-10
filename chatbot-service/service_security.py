import hmac
import os

from starlette.datastructures import Headers
from starlette.responses import JSONResponse


class InternalServiceAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or (
            scope["path"] == "/health" and scope["method"] in {"GET", "HEAD"}
        ):
            return await self.app(scope, receive, send)

        key = os.environ.get("CHATBOT_INTERNAL_API_KEY", "").strip() or os.environ.get("INTERNAL_API_KEY", "").strip()
        if len(key) < 32:
            response = JSONResponse(
                {"detail": "Chatbot service access is not configured."},
                status_code=503,
                headers={"Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)

        supplied = Headers(scope=scope).getlist("x-internal-key")
        if len(supplied) != 1 or not hmac.compare_digest(
            supplied[0].encode("utf-8"), key.encode("utf-8")
        ):
            response = JSONResponse(
                {"detail": "Service access denied."},
                status_code=403,
                headers={"Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)

        return await self.app(scope, receive, send)
