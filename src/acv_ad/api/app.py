from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from acv_ad.api.routes import router

VITE_DEV_SERVER_ORIGIN = "http://localhost:5173"


def create_app() -> FastAPI:
    app = FastAPI(title="ACV-AD API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[VITE_DEV_SERVER_ORIGIN],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app


app = create_app()
