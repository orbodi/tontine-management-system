from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_employe, require_admin
from ..repository import load_state

router = APIRouter(tags=["data"])


@router.get("/data")
def get_data(
    user: Annotated[dict[str, Any], Depends(current_employe)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    return load_state(db, include_password_hashes=False)


class MutationBody(BaseModel):
    payload: dict[str, Any] = {}


@router.post("/mutations/{action}")
def mutate(
    action: str,
    body: MutationBody,
    user: Annotated[dict[str, Any], Depends(current_employe)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    from .. import engine

    result = engine.run_mutation(db, user["id"], action, body.payload or {})
    if result.get("erreur"):
        return result
    return result


@router.post("/admin/reinitialiser-demo")
def reinitialiser_demo(
    user: Annotated[dict[str, Any], Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    from .. import engine

    result = engine.run_mutation(db, user["id"], "reinitialiserDemo", {})
    if result.get("erreur"):
        raise HTTPException(status_code=400, detail=result["erreur"])
    return result


@router.get("/admin/export-csv")
def export_csv(
    user: Annotated[dict[str, Any], Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    from ..backup import export_zip_bytes

    content, filename = export_zip_bytes(db)
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/admin/import-csv")
async def import_csv(
    user: Annotated[dict[str, Any], Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    fichier: UploadFile = File(...),
) -> dict[str, Any]:
    from ..backup import import_zip_bytes

    raw = await fichier.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Fichier vide.")
    try:
        data = import_zip_bytes(db, raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Import impossible : {exc}") from exc
    return {"ok": True, "data": data}
