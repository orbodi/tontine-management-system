from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .db import Base, SessionLocal, engine, migrate_schema
from . import models  # noqa: F401
from .routers import auth_router, data_router, comptabilite_router


def _ensure_startup_data() -> None:
    db: Session = SessionLocal()
    try:
        from .seed import ensure_startup_data
        from .comptabilite import ensure_comptabilite_seed

        ensure_startup_data(db)
        ensure_comptabilite_seed(db)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate_schema()
    _ensure_startup_data()
    yield


def create_app() -> FastAPI:
    application = FastAPI(title=settings.app_name, lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(auth_router, prefix="/api")
    application.include_router(data_router, prefix="/api")
    application.include_router(comptabilite_router, prefix="/api")

    @application.get("/api/health")
    def health():
        return {
            "ok": True,
            "service": settings.app_name,
            "seed_demo_on_startup": settings.seed_demo_on_startup,
            "create_default_accounts": settings.create_default_accounts,
        }

    return application


app = create_app()
