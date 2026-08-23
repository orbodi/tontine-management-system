from .auth import router as auth_router
from .data import router as data_router
from .comptabilite import router as comptabilite_router

__all__ = ["auth_router", "data_router", "comptabilite_router"]
