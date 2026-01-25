"""
JWT token creation and validation utilities for Auto-Claude authentication.

Tokens are base64 encoded NOT encrypted - never store sensitive data in payload.
Uses HS256 algorithm with SECRET_KEY from environment.
"""

import os
import jwt
import bcrypt
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# Load configuration from environment
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# HTTP Bearer security scheme for extracting JWT tokens from Authorization header
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Dict[str, Any]:
    """
    FastAPI dependency to validate JWT token and extract current user payload.

    Args:
        credentials: HTTP Bearer credentials extracted from Authorization header

    Returns:
        Token payload dict containing user information

    Raises:
        HTTPException: 401 if token is invalid, expired, or malformed

    Usage:
        ```python
        from fastapi import Depends
        from auth import get_current_user

        @app.get("/auth/me")
        async def get_current_user_info(current_user: Dict[str, Any] = Depends(get_current_user)):
            return current_user
        ```

    Note:
        This dependency extracts the token from the Authorization header
        in the format: "Bearer <token>". Returns the decoded payload
        which typically contains user identification like {"sub": user_id}.
    """
    token = credentials.credentials
    payload = verify_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token.

    Args:
        data: Payload data to encode in the token (e.g., {"sub": user_id})
        expires_delta: Optional custom expiration time

    Returns:
        Encoded JWT token as string

    Note:
        Tokens are base64 encoded, NOT encrypted. Never store sensitive data
        like passwords or API keys in the token payload.
        The "sub" claim is automatically converted to string as required by JWT spec.
    """
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})

    # Convert "sub" claim to string if it's an integer (JWT spec requirement)
    if "sub" in to_encode and isinstance(to_encode["sub"], int):
        to_encode["sub"] = str(to_encode["sub"])

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

    return encoded_jwt


def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Validate a JWT token and return its payload.

    Args:
        token: JWT token string to validate

    Returns:
        Token payload dict if valid, None if invalid/expired

    Note:
        Returns None for any JWT error (invalid signature, expired token,
        malformed token, etc.). Caller should check for None return value.
        The "sub" claim is automatically converted back to integer if it's a numeric string.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        # Convert "sub" back to integer if it's a numeric string
        if "sub" in payload and isinstance(payload["sub"], str):
            try:
                payload["sub"] = int(payload["sub"])
            except ValueError:
                pass  # Keep as string if not numeric

        return payload
    except jwt.PyJWTError:
        return None


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.

    Args:
        password: Plain text password to hash

    Returns:
        Salted bcrypt hash as string

    Note:
        Uses bcrypt with automatic salt generation. The resulting hash
        includes the salt, so no separate salt storage is needed.
        Hash length is typically 60 characters.
    """
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a plain text password against a bcrypt hash.

    Args:
        plain_password: Plain text password to verify
        hashed_password: Stored bcrypt hash to compare against

    Returns:
        True if password matches, False otherwise

    Note:
        Uses bcrypt's constant-time comparison to prevent timing attacks.
        Returns False for any error (invalid hash format, encoding issues, etc.).
    """
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False
