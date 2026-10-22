from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: DbSession) -> UserResponse:
    user = auth_service.register(db, payload)
    return UserResponse.from_model(user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: DbSession, response: Response) -> TokenResponse:
    _user, token = auth_service.login(db, payload)
    response.headers["Cache-Control"] = "no-store"
    return TokenResponse(access_token=token.token, expires_in=token.expires_in)


@router.get("/me", response_model=UserResponse)
def me(user: CurrentUser) -> UserResponse:
    return UserResponse.from_model(user)