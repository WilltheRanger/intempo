"""GET /v1/me — return the authenticated user.

First-touch provisioning: Supabase Auth and our `users` table are
separate. A user can have a valid JWT (signed up via Supabase Auth)
but no row in `users` yet — that happens on first call to /v1/me.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import current_jwt_payload
from app.db import get_service_client
from app.models.user import MeResponse, UserRole, UserTier

router = APIRouter(tags=["me"])


def _provision_user(client: Any, user_id: UUID, email: str) -> dict[str, Any]:
    """Create the users row on first /v1/me. Uses service role to bypass RLS."""
    insert = (
        client.table("users")
        .insert(
            {
                "id": str(user_id),
                "email": email,
                "tier": UserTier.free.value,
                "role": UserRole.student.value,
            }
        )
        .execute()
    )
    rows = insert.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to provision user row",
        )
    return rows[0]


@router.get("/me", response_model=MeResponse)
async def get_me(payload: dict[str, Any] = Depends(current_jwt_payload)) -> MeResponse:
    sub = payload.get("sub")
    email = payload.get("email")
    if not sub or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub/email",
        )
    try:
        user_id = UUID(sub)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token subject is not a UUID",
        ) from exc

    client = get_service_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service-role client is not configured",
        )

    existing = client.table("users").select("*").eq("id", str(user_id)).limit(1).execute()
    rows = existing.data or []
    row = rows[0] if rows else _provision_user(client, user_id, email)

    return MeResponse(
        id=user_id,
        email=row["email"],
        tier=UserTier(row.get("tier", UserTier.free.value)),
        role=UserRole(row.get("role", UserRole.student.value)),
        studio_id=UUID(row["studio_id"]) if row.get("studio_id") else None,
    )
