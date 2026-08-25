from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from semantic_vision.api.routes import router

VITE_DEV_SERVER_ORIGIN = "http://localhost:5173"

VSCODE_WEBVIEW_ORIGIN_PATTERN = r"^vscode-webview://.*"
"""A VS Code webview's origin is a synthetic `vscode-webview://<uuid>`, a
different uuid on every panel load -- a static `allow_origins` entry can't
enumerate it, so it needs its own regex rule alongside the dev server's
static one (`CORSMiddleware` accepts both at once; a request matching
either passes). See Milestone 16 (VS Code Extension)."""


def create_app() -> FastAPI:
    app = FastAPI(title="Semantic Vision API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[VITE_DEV_SERVER_ORIGIN],
        allow_origin_regex=VSCODE_WEBVIEW_ORIGIN_PATTERN,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app


app = create_app()
