from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .db import Base, SessionLocal, engine
from . import models  # noqa: F401
from .repository import get_employe_by_identifiant
from .routers import auth_router, data_router


def _ensure_seed() -> None:
    if not settings.seed_demo_on_startup:
        return
    db: Session = SessionLocal()
    try:
        if get_employe_by_identifiant(db, "admin") is None:
            from .seed import seed_database

            seed_database(db)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _ensure_seed()
    yield


def create_app() -> FastAPI:
    application = FastAPI(title=settings.app_name, lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(auth_router, prefix="/api")
    application.include_router(data_router, prefix="/api")

    @application.get("/api/health")
    def health():
        return {"ok": True, "service": settings.app_name}

    return application


app = create_app()
