from __future__ import annotations

import uvicorn

from bevvi_analytics_mcp.app import build_starlette_app
from bevvi_analytics_mcp.config import Settings


def main() -> None:
    settings = Settings.from_env()
    app = build_starlette_app(settings)
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
