from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from semantic_vision.api.routes import router

DEV_ORIGIN_PATTERN = r"^(vscode-webview://.*|http://localhost:\d+)$"
"""Two origins this API needs to accept, combined into one regex since
`CORSMiddleware` only takes a single `allow_origin_regex`:

- A VS Code webview's origin is a synthetic `vscode-webview://<uuid>`, a
  different uuid on every panel load -- a static `allow_origins` entry
  can't enumerate it. See Milestone 16 (VS Code Extension).
- `http://localhost:<any port>`, not just the default Vite dev server port
  (5173) -- a review/test tool (or a second `vite`/`vite preview` instance
  run alongside the main dev server) reasonably binds to a different local
  port, and there's no meaningful security boundary being enforced by
  pinning this to one specific port number: this API is already
  localhost-only, so anything that can reach it can already reach it
  regardless of which local port it happens to be calling from."""


def create_app() -> FastAPI:
    app = FastAPI(title="Semantic Vision API")
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=DEV_ORIGIN_PATTERN,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app


app = create_app()
