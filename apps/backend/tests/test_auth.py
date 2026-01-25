#!/usr/bin/env python3
"""
Unit Tests for Authentication System
=====================================

Tests the authentication module functionality including:
- Password hashing and verification with bcrypt
- JWT token creation and validation
- User registration and authentication
- User creation and retrieval

This tests the NEW authentication system (apps/backend/auth.py and
services/auth_service.py), NOT the core/auth.py module which is for
Claude Code CLI OAuth.
"""

import os
import sys
from datetime import datetime, timedelta
from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Add apps/backend to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

# Set SECRET_KEY for tests before importing auth module
os.environ["SECRET_KEY"] = "test-secret-key-for-jwt-tokens"

from auth import hash_password, verify_password, create_access_token, verify_token, SECRET_KEY
from models import Base, User
from database import get_db
from services.auth_service import create_user, authenticate_user, get_user_by_id, get_user_by_email
from schemas import UserCreate

# Override SECRET_KEY at module level for tests
auth_module = sys.modules['auth']
auth_module.SECRET_KEY = "test-secret-key-for-jwt-tokens"


# ============================================================================
# Test Database Setup
# ============================================================================

@pytest.fixture(scope="function", autouse=True)
def set_test_secret_key():
    """
    Set test SECRET_KEY environment variable before each test.

    This must be autouse so it runs before every test, ensuring
    JWT tokens created in tests can be verified.
    """
    original_key = os.environ.get("SECRET_KEY")
    os.environ["SECRET_KEY"] = "test-secret-key-for-jwt-tokens"
    yield
    # Restore original key after test
    if original_key is None:
        os.environ.pop("SECRET_KEY", None)
    else:
        os.environ["SECRET_KEY"] = original_key


@pytest.fixture(scope="function")
def db_session():
    """
    Create a test database session for each test.

    Uses SQLite in-memory database for fast, isolated tests.
    All tables are created before each test and dropped after.
    """
    # Use in-memory SQLite for fast tests
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False}
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Create all tables
    Base.metadata.create_all(bind=engine)

    # Create session
    session = TestingSessionLocal()

    yield session

    # Cleanup: close session and drop all tables
    session.close()
    Base.metadata.drop_all(bind=engine)


# ============================================================================
# Password Hashing Tests
# ============================================================================

class TestPasswordHashing:
    """Tests for bcrypt password hashing and verification."""

    def test_hash_password_returns_string(self):
        """Verify hash_password() returns a string."""
        password = "testpassword123"
        hashed = hash_password(password)

        assert isinstance(hashed, str)
        assert len(hashed) == 60  # Bcrypt hashes are always 60 chars

    def test_hash_password_is_unique(self):
        """Verify hashing the same password twice produces different hashes."""
        password = "testpassword123"
        hash1 = hash_password(password)
        hash2 = hash_password(password)

        # Hashes should be different due to random salt
        assert hash1 != hash2
        # But both should start with $2b$ (bcrypt identifier)
        assert hash1.startswith("$2b$")
        assert hash2.startswith("$2b$")

    def test_hash_password_minimum_length(self):
        """Verify hash_password() works with minimum 8 character password."""
        password = "12345678"  # Minimum valid length
        hashed = hash_password(password)

        assert isinstance(hashed, str)
        assert len(hashed) == 60

    def test_verify_password_correct_password(self):
        """Verify verify_password() returns True for correct password."""
        password = "testpassword123"
        hashed = hash_password(password)

        result = verify_password(password, hashed)
        assert result is True

    def test_verify_password_incorrect_password(self):
        """Verify verify_password() returns False for incorrect password."""
        password = "testpassword123"
        wrong_password = "wrongpassword456"
        hashed = hash_password(password)

        result = verify_password(wrong_password, hashed)
        assert result is False

    def test_verify_password_empty_password(self):
        """Verify verify_password() returns False for empty password."""
        password = "testpassword123"
        hashed = hash_password(password)

        result = verify_password("", hashed)
        assert result is False

    def test_verify_password_invalid_hash_format(self):
        """Verify verify_password() returns False for invalid hash format."""
        password = "testpassword123"
        invalid_hash = "not-a-valid-bcrypt-hash"

        result = verify_password(password, invalid_hash)
        assert result is False

    def test_hash_and_verify_roundtrip(self):
        """Verify complete hash/verify workflow works correctly."""
        original_password = "MySecurePassword123!"

        # Hash the password
        hashed = hash_password(original_password)
        assert hashed != original_password

        # Verify correct password works
        assert verify_password(original_password, hashed) is True

        # Verify incorrect password doesn't work
        assert verify_password("WrongPassword", hashed) is False


# ============================================================================
# JWT Token Tests
# ============================================================================

class TestJWTTokens:
    """Tests for JWT token creation and validation."""

    def test_create_access_token_returns_string(self):
        """Verify create_access_token() returns a string token."""
        data = {"sub": 1}
        token = create_access_token(data)

        assert isinstance(token, str)
        assert len(token) > 0

    def test_create_token_includes_expiration(self):
        """Verify token includes expiration claim."""
        data = {"sub": 1}
        token = create_access_token(data)

        # Decode token to check payload (without verification)
        import jwt
        payload = jwt.decode(token, options={"verify_signature": False})

        assert "exp" in payload
        # Note: "sub" is stored as string in token per JWT spec
        assert payload["sub"] == "1"  # String, not int

    def test_create_token_custom_expiration(self):
        """Verify token respects custom expiration time."""
        data = {"sub": 1}
        custom_delta = timedelta(minutes=60)
        token = create_access_token(data, expires_delta=custom_delta)

        # Decode and check expiration
        import jwt
        payload = jwt.decode(token, options={"verify_signature": False})

        exp_timestamp = payload["exp"]
        exp_datetime = datetime.utcfromtimestamp(exp_timestamp)

        # Should be approximately 60 minutes from now
        now = datetime.utcnow()
        time_diff = (exp_datetime - now).total_seconds()

        # Allow 5 second tolerance for test execution time
        assert 3595 <= time_diff <= 3605

    def test_verify_token_valid(self):
        """Verify verify_token() returns payload for valid token."""
        data = {"sub": 1, "email": "test@example.com"}
        token = create_access_token(data)

        payload = verify_token(token)

        assert payload is not None
        assert payload["sub"] == 1
        assert payload["email"] == "test@example.com"
        assert "exp" in payload

    def test_verify_token_invalid_signature(self):
        """Verify verify_token() returns None for invalid signature."""
        # Create a fake token with invalid signature
        fake_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjF9.invalid-signature"

        payload = verify_token(fake_token)
        assert payload is None

    def test_verify_token_malformed(self):
        """Verify verify_token() returns None for malformed token."""
        malformed_tokens = [
            "not-a-jwt",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",  # Only header
            "",  # Empty string
            "abc.def",  # Only two parts
        ]

        for token in malformed_tokens:
            payload = verify_token(token)
            assert payload is None, f"Expected None for token: {token}"

    def test_verify_token_expired(self):
        """Verify verify_token() returns None for expired token."""
        data = {"sub": 1}
        # Create token that's already expired
        expired_delta = timedelta(seconds=-1)
        token = create_access_token(data, expires_delta=expired_delta)

        payload = verify_token(token)
        assert payload is None

    def test_token_payload_contains_user_id(self):
        """Verify token payload contains user ID in 'sub' claim."""
        user_id = 42
        data = {"sub": user_id}
        token = create_access_token(data)

        payload = verify_token(token)
        assert payload is not None
        assert payload["sub"] == user_id


# ============================================================================
# User Creation Tests
# ============================================================================

class TestUserCreation:
    """Tests for user creation functionality."""

    def test_create_user_success(self, db_session):
        """Verify user is created successfully with valid data."""
        user_data = UserCreate(
            email="test@example.com",
            password="securepass123"
        )

        user = create_user(db_session, user_data)

        assert user is not None
        assert user.id is not None
        assert user.email == "test@example.com"
        assert user.hashed_password != "securepass123"  # Should be hashed
        assert user.created_at is not None
        assert isinstance(user.created_at, datetime)

    def test_create_user_hashes_password(self, db_session):
        """Verify password is hashed before storage."""
        user_data = UserCreate(
            email="test@example.com",
            password="plainpassword123"
        )

        user = create_user(db_session, user_data)

        # Password should not be stored as plaintext
        assert user.hashed_password != "plainpassword123"
        # Should be bcrypt hash (60 chars, starts with $2b$)
        assert len(user.hashed_password) == 60
        assert user.hashed_password.startswith("$2b$")

    def test_create_user_duplicate_email_raises_error(self, db_session):
        """Verify creating user with duplicate email raises ValueError."""
        user_data = UserCreate(
            email="test@example.com",
            password="securepass123"
        )

        # Create first user
        create_user(db_session, user_data)

        # Try to create duplicate user
        with pytest.raises(ValueError, match="already exists"):
            create_user(db_session, user_data)

    def test_create_user_different_emails_allowed(self, db_session):
        """Verify users with different emails can be created."""
        user1_data = UserCreate(
            email="user1@example.com",
            password="password123"
        )
        user2_data = UserCreate(
            email="user2@example.com",
            password="password456"
        )

        user1 = create_user(db_session, user1_data)
        user2 = create_user(db_session, user2_data)

        assert user1.id != user2.id
        assert user1.email != user2.email
        assert db_session.query(User).count() == 2

    def test_create_user_minimum_password_length(self, db_session):
        """Verify user can be created with 8 character password."""
        user_data = UserCreate(
            email="test@example.com",
            password="12345678"  # Exactly 8 characters
        )

        user = create_user(db_session, user_data)
        assert user is not None
        assert user.email == "test@example.com"


# ============================================================================
# User Authentication Tests
# ============================================================================

class TestUserAuthentication:
    """Tests for user authentication functionality."""

    def test_authenticate_user_valid_credentials(self, db_session):
        """Verify authentication succeeds with valid credentials."""
        # Create a user first
        user_data = UserCreate(
            email="test@example.com",
            password="correctpassword"
        )
        create_user(db_session, user_data)

        # Authenticate with correct credentials
        user = authenticate_user(db_session, "test@example.com", "correctpassword")

        assert user is not None
        assert user.email == "test@example.com"

    def test_authenticate_user_invalid_password(self, db_session):
        """Verify authentication fails with invalid password."""
        # Create a user first
        user_data = UserCreate(
            email="test@example.com",
            password="correctpassword"
        )
        create_user(db_session, user_data)

        # Try to authenticate with wrong password
        user = authenticate_user(db_session, "test@example.com", "wrongpassword")

        assert user is None

    def test_authenticate_user_nonexistent_email(self, db_session):
        """Verify authentication fails for non-existent email."""
        user = authenticate_user(db_session, "nonexistent@example.com", "password")

        assert user is None

    def test_authenticate_user_case_sensitive_email(self, db_session):
        """Verify email authentication is case-sensitive."""
        user_data = UserCreate(
            email="Test@Example.com",  # Mixed case
            password="password123"
        )
        create_user(db_session, user_data)

        # Try with different case
        user = authenticate_user(db_session, "test@example.com", "password123")

        # Should fail (case-sensitive)
        assert user is None

    def test_authenticate_user_empty_password(self, db_session):
        """Verify authentication fails with empty password."""
        user_data = UserCreate(
            email="test@example.com",
            password="password123"
        )
        create_user(db_session, user_data)

        user = authenticate_user(db_session, "test@example.com", "")

        assert user is None


# ============================================================================
# User Retrieval Tests
# ============================================================================

class TestUserRetrieval:
    """Tests for user retrieval functionality."""

    def test_get_user_by_id_exists(self, db_session):
        """Verify get_user_by_id() returns user when found."""
        user_data = UserCreate(
            email="test@example.com",
            password="password123"
        )
        created_user = create_user(db_session, user_data)

        retrieved_user = get_user_by_id(db_session, created_user.id)

        assert retrieved_user is not None
        assert retrieved_user.id == created_user.id
        assert retrieved_user.email == "test@example.com"

    def test_get_user_by_id_not_exists(self, db_session):
        """Verify get_user_by_id() returns None when user not found."""
        user = get_user_by_id(db_session, 999)

        assert user is None

    def test_get_user_by_email_exists(self, db_session):
        """Verify get_user_by_email() returns user when found."""
        user_data = UserCreate(
            email="test@example.com",
            password="password123"
        )
        create_user(db_session, user_data)

        retrieved_user = get_user_by_email(db_session, "test@example.com")

        assert retrieved_user is not None
        assert retrieved_user.email == "test@example.com"

    def test_get_user_by_email_not_exists(self, db_session):
        """Verify get_user_by_email() returns None when user not found."""
        user = get_user_by_email(db_session, "nonexistent@example.com")

        assert user is None

    def test_get_user_by_email_case_sensitive(self, db_session):
        """Verify get_user_by_email() is case-sensitive."""
        user_data = UserCreate(
            email="Test@Example.com",
            password="password123"
        )
        create_user(db_session, user_data)

        # Try with different case
        user = get_user_by_email(db_session, "test@example.com")

        assert user is None


# ============================================================================
# Integration Tests
# ============================================================================

class TestAuthIntegration:
    """Integration tests for authentication workflow."""

    def test_complete_registration_login_flow(self, db_session):
        """Verify complete user registration and login flow."""
        # Step 1: Register user
        user_data = UserCreate(
            email="user@example.com",
            password="securepass123"
        )
        user = create_user(db_session, user_data)
        assert user.id is not None

        # Step 2: Authenticate with correct credentials
        authenticated_user = authenticate_user(
            db_session,
            "user@example.com",
            "securepass123"
        )
        assert authenticated_user is not None
        assert authenticated_user.id == user.id

        # Step 3: Create JWT token for authenticated user
        token = create_access_token({"sub": user.id})
        assert token is not None

        # Step 4: Verify token is valid
        token_payload = verify_token(token)
        assert token_payload is not None
        assert token_payload["sub"] == user.id

    def test_invalid_login_flow(self, db_session):
        """Verify login flow handles invalid credentials correctly."""
        # Register user
        user_data = UserCreate(
            email="user@example.com",
            password="correctpass"
        )
        create_user(db_session, user_data)

        # Try to authenticate with wrong password
        authenticated_user = authenticate_user(
            db_session,
            "user@example.com",
            "wrongpass"
        )
        assert authenticated_user is None

    def test_token_expiration_prevents_authentication(self, db_session):
        """Verify expired tokens cannot be used for authentication."""
        user_data = UserCreate(
            email="user@example.com",
            password="password123"
        )
        user = create_user(db_session, user_data)

        # Create expired token
        expired_token = create_access_token(
            {"sub": user.id},
            expires_delta=timedelta(seconds=-1)
        )

        # Try to verify expired token
        payload = verify_token(expired_token)
        assert payload is None
