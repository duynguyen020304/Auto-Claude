"""
JWT token creation and validation utilities for Auto-Claude authentication.

Tokens are base64 encoded NOT encrypted - never store sensitive data in payload.
Uses HS256 algorithm with SECRET_KEY from environment.
"""

import os
import jwt
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

# Load configuration from environment
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30


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
    """
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire})
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
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None
