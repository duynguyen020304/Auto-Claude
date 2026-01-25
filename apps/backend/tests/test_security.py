#!/usr/bin/env python3
"""
Security Tests for Authentication and History System
====================================================

Tests critical security aspects of the authentication and history system:
- User data isolation (preventing cross-user data leakage)
- SQL injection prevention (parameterized queries)
- JWT validation (token verification on protected routes)

These tests ensure that:
1. Users can only access their own data
2. SQL injection attacks are prevented by SQLAlchemy ORM
3. JWT tokens are properly validated on protected routes
"""

import os
import sys
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Add apps/backend to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

# Set SECRET_KEY for tests before importing auth module
os.environ["SECRET_KEY"] = "test-secret-key-for-jwt-tokens"

from auth import hash_password, create_access_token, verify_token, get_current_user
from models import Base, User, ChatHistory, IdeationHistory, RoadmapHistory, RepoHistory
from database import get_db
from services.auth_service import create_user, authenticate_user
from services.history_service import (
    create_chat_history, get_chat_history, get_user_chat_histories,
    update_chat_history, delete_chat_history,
    create_ideation_history, get_ideation_history, update_ideation_history,
    delete_ideation_history,
    create_roadmap_history, get_roadmap_history, update_roadmap_history,
    delete_roadmap_history,
    create_repo_history, get_repo_history, update_repo_history,
    delete_repo_history
)
from schemas import (
    UserCreate,
    ChatHistoryCreate, ChatHistoryUpdate,
    IdeationHistoryCreate, IdeationHistoryUpdate,
    RoadmapHistoryCreate, RoadmapHistoryUpdate,
    RepoHistoryCreate, RepoHistoryUpdate
)

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials


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


@pytest.fixture(scope="function")
def user_a(db_session):
    """Create test user A for isolation tests."""
    user_data = UserCreate(
        email="usera@example.com",
        password="password123"
    )
    return create_user(db_session, user_data)


@pytest.fixture(scope="function")
def user_b(db_session):
    """Create test user B for isolation tests."""
    user_data = UserCreate(
        email="userb@example.com",
        password="password456"
    )
    return create_user(db_session, user_data)


# ============================================================================
# User Data Isolation Tests
# ============================================================================

class TestUserDataIsolation:
    """
    Tests for user data isolation.

    Ensures that users can only access their own data and cannot
    access or modify data belonging to other users.
    """

    def test_user_a_cannot_access_user_b_chat_history(self, db_session, user_a, user_b):
        """
        Verify User A cannot access User B's chat history.

        This is a critical security test to prevent cross-user data leakage.
        """
        # User B creates a chat history
        history_data = ChatHistoryCreate(
            title="User B's Secret Chat",
            messages=[{"role": "user", "content": "Secret data"}]
        )
        user_b_history = create_chat_history(db_session, user_b.id, history_data)

        # User A tries to access User B's history
        accessed_history = get_chat_history(db_session, user_b_history.id, user_a.id)

        # Should return None (access denied)
        assert accessed_history is None, "User A should not be able to access User B's chat history"

    def test_user_a_cannot_update_user_b_chat_history(self, db_session, user_a, user_b):
        """
        Verify User A cannot update User B's chat history.
        """
        # User B creates a chat history
        history_data = ChatHistoryCreate(
            title="Original Title",
            messages=[{"role": "user", "content": "Original content"}]
        )
        user_b_history = create_chat_history(db_session, user_b.id, history_data)

        # User A tries to update User B's history
        update_data = ChatHistoryUpdate(title="Hacked Title")
        updated_history = update_chat_history(
            db_session,
            user_b_history.id,
            user_a.id,
            update_data
        )

        # Should return None (update denied)
        assert updated_history is None, "User A should not be able to update User B's chat history"

        # Verify the history was not actually updated
        original_history = get_chat_history(db_session, user_b_history.id, user_b.id)
        assert original_history.title == "Original Title", "History should remain unchanged"

    def test_user_a_cannot_delete_user_b_chat_history(self, db_session, user_a, user_b):
        """
        Verify User A cannot delete User B's chat history.
        """
        # User B creates a chat history
        history_data = ChatHistoryCreate(
            title="User B's History",
            messages=[{"role": "user", "content": "Content"}]
        )
        user_b_history = create_chat_history(db_session, user_b.id, history_data)

        # User A tries to delete User B's history
        result = delete_chat_history(db_session, user_b_history.id, user_a.id)

        # Should return False (deletion denied)
        assert result is False, "User A should not be able to delete User B's chat history"

        # Verify the history still exists for User B
        existing_history = get_chat_history(db_session, user_b_history.id, user_b.id)
        assert existing_history is not None, "History should still exist for User B"

    def test_get_user_chat_histories_only_returns_own_data(self, db_session, user_a, user_b):
        """
        Verify get_user_chat_histories only returns the requesting user's data.
        """
        # User A creates 2 chat histories
        for i in range(2):
            history_data = ChatHistoryCreate(
                title=f"User A Chat {i}",
                messages=[{"role": "user", "content": f"Content {i}"}]
            )
            create_chat_history(db_session, user_a.id, history_data)

        # User B creates 3 chat histories
        for i in range(3):
            history_data = ChatHistoryCreate(
                title=f"User B Chat {i}",
                messages=[{"role": "user", "content": f"Content {i}"}]
            )
            create_chat_history(db_session, user_b.id, history_data)

        # User A requests their histories
        user_a_histories = get_user_chat_histories(db_session, user_a.id)
        user_b_histories = get_user_chat_histories(db_session, user_b.id)

        # Each user should only see their own histories
        assert len(user_a_histories) == 2, "User A should only see their 2 histories"
        assert len(user_b_histories) == 3, "User B should only see their 3 histories"

        # Verify all returned histories belong to the correct user
        for history in user_a_histories:
            assert history.user_id == user_a.id, "All histories should belong to User A"

        for history in user_b_histories:
            assert history.user_id == user_b.id, "All histories should belong to User B"

    def test_isolation_for_all_history_types(self, db_session, user_a, user_b):
        """
        Verify user data isolation works for all 4 history types.
        """
        # Test Chat History
        chat_data = ChatHistoryCreate(title="Chat", messages=[])
        user_b_chat = create_chat_history(db_session, user_b.id, chat_data)
        assert get_chat_history(db_session, user_b_chat.id, user_a.id) is None

        # Test Ideation History
        ideation_data = IdeationHistoryCreate(
            title="Ideation",
            content="Content",
            tags=[]
        )
        user_b_ideation = create_ideation_history(db_session, user_b.id, ideation_data)
        assert get_ideation_history(db_session, user_b_ideation.id, user_a.id) is None

        # Test Roadmap History
        roadmap_data = RoadmapHistoryCreate(
            title="Roadmap",
            version="1.0",
            content="Content"
        )
        user_b_roadmap = create_roadmap_history(db_session, user_b.id, roadmap_data)
        assert get_roadmap_history(db_session, user_b_roadmap.id, user_a.id) is None

        # Test Repo History
        repo_data = RepoHistoryCreate(
            repo_name="test/repo",
            repo_url="https://github.com/test/repo",
            interaction_type="clone",
            metadata={}
        )
        user_b_repo = create_repo_history(db_session, user_b.id, repo_data)
        assert get_repo_history(db_session, user_b_repo.id, user_a.id) is None

    def test_search_filter_respects_user_isolation(self, db_session, user_a, user_b):
        """
        Verify search functionality respects user boundaries.
        """
        # User A creates a chat with "Secret" in title
        chat_a = ChatHistoryCreate(
            title="User A Secret Chat",
            messages=[]
        )
        create_chat_history(db_session, user_a.id, chat_a)

        # User B creates a chat with "Secret" in title
        chat_b = ChatHistoryCreate(
            title="User B Secret Chat",
            messages=[]
        )
        create_chat_history(db_session, user_b.id, chat_b)

        # User A searches for "Secret"
        results = get_user_chat_histories(db_session, user_a.id, search="Secret")

        # Should only return User A's secret chat, not User B's
        assert len(results) == 1, "Search should only return User A's results"
        assert results[0].user_id == user_a.id, "Result should belong to User A"
        assert results[0].title == "User A Secret Chat"


# ============================================================================
# SQL Injection Prevention Tests
# ============================================================================

class TestSQLInjectionPrevention:
    """
    Tests for SQL injection prevention.

    Ensures that SQLAlchemy's parameterized queries prevent SQL injection
    attacks in user input fields (search, titles, content, etc.).
    """

    def test_sql_injection_in_search_query(self, db_session, user_a):
        """
        Verify SQL injection attempts in search queries are neutralized.

        SQLAlchemy's ORM uses parameterized queries which prevent SQL injection.
        This test verifies that malicious input is treated as literal strings.
        """
        # Create a normal chat history
        history_data = ChatHistoryCreate(
            title="Normal Chat",
            messages=[]
        )
        create_chat_history(db_session, user_a.id, history_data)

        # Try SQL injection in search parameter
        sql_injection_payload = "Normal Chat' OR '1'='1"
        results = get_user_chat_histories(db_session, user_a.id, search=sql_injection_payload)

        # Should not crash or return unintended data
        # The injection attempt should be treated as a literal search string
        assert isinstance(results, list), "Should return a list"

        # Since we're searching for a title that doesn't exist (the injection string),
        # we should get 0 results
        assert len(results) == 0, "SQL injection should not return unintended results"

    def test_sql_injection_in_title_field(self, db_session, user_a):
        """
        Verify SQL injection in title field is safely stored and retrieved.
        """
        # SQL injection payload as title
        injection_payload = "'; DROP TABLE users; --"
        history_data = ChatHistoryCreate(
            title=injection_payload,
            messages=[]
        )

        # Should create successfully without executing SQL injection
        history = create_chat_history(db_session, user_a.id, history_data)
        assert history is not None, "History with injection payload should be created"

        # Should be retrievable
        retrieved = get_chat_history(db_session, history.id, user_a.id)
        assert retrieved is not None, "History should be retrievable"
        assert retrieved.title == injection_payload, "Title should be stored as-is"

        # Verify the users table still exists (injection was prevented)
        user_count = db_session.query(User).count()
        assert user_count >= 1, "Users table should still exist"

    def test_sql_injection_in_content_field(self, db_session, user_a):
        """
        Verify SQL injection in content field is safely handled.
        """
        injection_payload = {"role": "user", "content": "'; DROP TABLE chat_histories; --"}
        history_data = ChatHistoryCreate(
            title="Test",
            messages=[injection_payload]
        )

        history = create_chat_history(db_session, user_a.id, history_data)
        assert history is not None

        # Verify content is stored as JSON, not executed
        assert history.messages[0]["content"] == "'; DROP TABLE chat_histories; --"

    def test_union_based_sql_injection(self, db_session, user_a):
        """
        Verify UNION-based SQL injection is prevented.
        """
        # Create a chat history
        history_data = ChatHistoryCreate(
            title="Test Chat",
            messages=[]
        )
        create_chat_history(db_session, user_a.id, history_data)

        # Try UNION-based injection in search
        union_injection = "Test Chat' UNION SELECT * FROM users WHERE '1'='1"
        results = get_user_chat_histories(db_session, user_a.id, search=union_injection)

        # Should not leak user data via UNION injection
        assert isinstance(results, list)
        # The search should not return user records
        for result in results:
            assert isinstance(result, ChatHistory), "Results should be ChatHistory objects"

    def test_boolean_based_sql_injection(self, db_session, user_a):
        """
        Verify boolean-based SQL injection is prevented.
        """
        # Create chat histories
        create_chat_history(db_session, user_a.id, ChatHistoryCreate(title="Chat 1", messages=[]))
        create_chat_history(db_session, user_a.id, ChatHistoryCreate(title="Chat 2", messages=[]))

        # Try boolean-based injection
        boolean_injection = "Chat 1' AND 1=1 --"
        results = get_user_chat_histories(db_session, user_a.id, search=boolean_injection)

        # Should handle safely without executing the boolean logic
        assert isinstance(results, list)

    def test_stored_procedure_injection_attempt(self, db_session, user_a):
        """
        Verify stored procedure injection attempts are neutralized.
        """
        injection_payload = "'; EXEC sp_configure 'show advanced options', 1; --"
        history_data = ChatHistoryCreate(
            title=injection_payload,
            messages=[]
        )

        # Should store as literal string, not execute
        history = create_chat_history(db_session, user_a.id, history_data)
        assert history is not None
        assert history.title == injection_payload

    def test_time_based_blind_sql_injection(self, db_session, user_a):
        """
        Verify time-based blind SQL injection is prevented.
        """
        # Create a chat history
        history_data = ChatHistoryCreate(
            title="Test Chat",
            messages=[]
        )
        create_chat_history(db_session, user_a.id, history_data)

        # Try time-based injection (would cause delay if successful)
        time_injection = "Test Chat' AND WAITFOR DELAY '00:00:05' --"
        import time
        start = time.time()
        results = get_user_chat_histories(db_session, user_a.id, search=time_injection)
        elapsed = time.time() - start

        # Should return quickly (no 5-second delay from injection)
        assert elapsed < 2, "Query should not be delayed by SQL injection attempt"

    def test_xss_injection_in_content(self, db_session, user_a):
        """
        Verify XSS payload in content is safely stored (not SQL injection but related).

        While XSS is a frontend concern, this verifies the backend stores
        malicious payloads as-is without sanitization (frontend handles escaping).
        """
        xss_payload = "<script>alert('XSS')</script>"
        history_data = ChatHistoryCreate(
            title="Test",
            messages=[{"role": "user", "content": xss_payload}]
        )

        history = create_chat_history(db_session, user_a.id, history_data)
        assert history.messages[0]["content"] == xss_payload

        retrieved = get_chat_history(db_session, history.id, user_a.id)
        assert retrieved.messages[0]["content"] == xss_payload


# ============================================================================
# JWT Validation Tests
# ============================================================================

class TestJWTValidation:
    """
    Tests for JWT token validation on protected routes.

    Ensures that:
    - Valid tokens are accepted
    - Invalid tokens are rejected
    - Expired tokens are rejected
    - Malformed tokens are rejected
    - Tokens with invalid signatures are rejected
    """

    def test_get_current_user_with_valid_token(self):
        """
        Verify get_current_user accepts valid JWT token.
        """
        # Create a valid token
        user_id = 123
        token = create_access_token({"sub": user_id, "email": "test@example.com"})

        # Create mock credentials
        credentials = Mock(spec=HTTPAuthorizationCredentials)
        credentials.credentials = token

        # Should successfully decode and return payload
        payload = get_current_user(credentials)
        assert payload is not None
        assert payload["sub"] == user_id
        assert payload["email"] == "test@example.com"

    def test_get_current_user_with_invalid_signature(self):
        """
        Verify get_current_user rejects token with invalid signature.
        """
        # Create a fake token with invalid signature
        fake_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEyM30.invalid-signature"

        credentials = Mock(spec=HTTPAuthorizationCredentials)
        credentials.credentials = fake_token

        # Should raise HTTPException 401
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(credentials)

        assert exc_info.value.status_code == 401
        assert "Could not validate credentials" in exc_info.value.detail

    def test_get_current_user_with_expired_token(self):
        """
        Verify get_current_user rejects expired token.
        """
        # Create an expired token
        user_id = 123
        expired_delta = timedelta(seconds=-1)
        expired_token = create_access_token(
            {"sub": user_id},
            expires_delta=expired_delta
        )

        credentials = Mock(spec=HTTPAuthorizationCredentials)
        credentials.credentials = expired_token

        # Should raise HTTPException 401
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(credentials)

        assert exc_info.value.status_code == 401
        assert "Could not validate credentials" in exc_info.value.detail

    def test_get_current_user_with_malformed_token(self):
        """
        Verify get_current_user rejects malformed tokens.
        """
        malformed_tokens = [
            "not-a-jwt",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",  # Only header
            "",  # Empty string
            "abc.def",  # Only two parts
            "bearer.token",  # Incorrect format
        ]

        for malformed_token in malformed_tokens:
            credentials = Mock(spec=HTTPAuthorizationCredentials)
            credentials.credentials = malformed_token

            # Should raise HTTPException 401
            with pytest.raises(HTTPException) as exc_info:
                get_current_user(credentials)

            assert exc_info.value.status_code == 401

    def test_get_current_user_with_none_token(self):
        """
        Verify get_current_user handles None token gracefully.
        """
        credentials = Mock(spec=HTTPAuthorizationCredentials)
        credentials.credentials = None

        # Should raise HTTPException
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(credentials)

        assert exc_info.value.status_code == 401

    def test_token_without_expiration_claim(self):
        """
        Verify token without 'exp' claim is handled (should be invalid).
        """
        import jwt

        # Create a token without exp claim (manually)
        payload = {"sub": 123, "email": "test@example.com"}
        token = jwt.encode(payload, os.environ["SECRET_KEY"], algorithm="HS256")

        credentials = Mock(spec=HTTPAuthorizationCredentials)
        credentials.credentials = token

        # get_current_user should reject it (verify_token checks expiration)
        # Note: Our create_access_token always adds exp, but we test the case
        # where a manually crafted token without exp is used
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(credentials)

        assert exc_info.value.status_code == 401

    def test_token_with_future_expiration(self):
        """
        Verify token with far-future expiration is accepted (if valid).
        """
        # Create token with expiration 1 year in future
        user_id = 123
        future_delta = timedelta(days=365)
        token = create_access_token(
            {"sub": user_id},
            expires_delta=future_delta
        )

        credentials = Mock(spec=HTTPAuthorizationCredentials)
        credentials.credentials = token

        # Should accept the token (not expired yet)
        payload = get_current_user(credentials)
        assert payload is not None
        assert payload["sub"] == user_id

    def test_token_with_different_algorithm(self):
        """
        Verify token signed with different algorithm is rejected.
        """
        import jwt

        # Create token with HS256 algorithm but trying to use none algorithm
        payload = {"sub": 123}
        # Try to create with 'none' algorithm (insecure)
        try:
            token = jwt.encode(payload, "", algorithm="none")
        except Exception:
            # If jwt library prevents 'none' algorithm, that's good
            # Skip this test
            pytest.skip("JWT library prevents 'none' algorithm")
            return

        credentials = Mock(spec=HTTPAuthorizationCredentials)
        credentials.credentials = token

        # Should reject token with 'none' algorithm
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(credentials)

        assert exc_info.value.status_code == 401

    def test_token_tampering_prevention(self):
        """
        Verify tampered tokens are rejected.
        """
        # Create a valid token
        token = create_access_token({"sub": 123})

        # Tamper with the token (change a character in the payload)
        tampered_token = token[:-10] + "tampered" + token[-5:]

        credentials = Mock(spec=HTTPAuthorizationCredentials)
        credentials.credentials = tampered_token

        # Should reject tampered token (signature won't match)
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(credentials)

        assert exc_info.value.status_code == 401

    def test_token_with_wrong_secret_key(self):
        """
        Verify token created with different secret is rejected.
        """
        import jwt

        # Create token with wrong secret
        wrong_secret = "wrong-secret-key"
        payload = {"sub": 123, "exp": datetime.utcnow() + timedelta(minutes=30)}
        token = jwt.encode(payload, wrong_secret, algorithm="HS256")

        credentials = Mock(spec=HTTPAuthorizationCredentials)
        credentials.credentials = token

        # Should reject token (signature verification fails)
        with pytest.raises(HTTPException) as exc_info:
            get_current_user(credentials)

        assert exc_info.value.status_code == 401


# ============================================================================
# Integration Security Tests
# ============================================================================

class TestSecurityIntegration:
    """
    Integration tests combining multiple security aspects.
    """

    def test_authentication_and_authorization_flow(self, db_session):
        """
        Verify complete authentication and authorization flow with security checks.
        """
        # Create two users
        user_a_data = UserCreate(email="usera@example.com", password="pass123")
        user_b_data = UserCreate(email="userb@example.com", password="pass456")
        user_a = create_user(db_session, user_a_data)
        user_b = create_user(db_session, user_b_data)

        # User A creates a token
        token_a = create_access_token({"sub": user_a.id})

        # User A creates a chat history
        history_data = ChatHistoryCreate(title="User A's Chat", messages=[])
        history = create_chat_history(db_session, user_a.id, history_data)

        # Verify User A can access their own data
        credentials_a = Mock(spec=HTTPAuthorizationCredentials)
        credentials_a.credentials = token_a
        payload_a = get_current_user(credentials_a)
        assert payload_a["sub"] == user_a.id

        retrieved = get_chat_history(db_session, history.id, user_a.id)
        assert retrieved is not None
        assert retrieved.user_id == user_a.id

        # Verify User B cannot access User A's data (even with valid token for B)
        token_b = create_access_token({"sub": user_b.id})
        credentials_b = Mock(spec=HTTPAuthorizationCredentials)
        credentials_b.credentials = token_b
        payload_b = get_current_user(credentials_b)
        assert payload_b["sub"] == user_b.id

        # User B tries to access User A's history
        access_denied = get_chat_history(db_session, history.id, user_b.id)
        assert access_denied is None

    def test_brute_force_protection_simulation(self, db_session):
        """
        Simulate brute force attack on authentication (conceptual test).

        Note: Real brute force protection requires rate limiting middleware
        or external services like Redis. This test verifies that
        authentication correctly rejects invalid credentials.
        """
        # Create a user
        user_data = UserCreate(email="test@example.com", password="correctpass")
        create_user(db_session, user_data)

        # Simulate brute force with multiple incorrect password attempts
        wrong_passwords = ["wrong1", "wrong2", "wrong3", "wrong4", "wrong5"]

        for wrong_pass in wrong_passwords:
            authenticated = authenticate_user(db_session, "test@example.com", wrong_pass)
            assert authenticated is None, f"Should reject incorrect password: {wrong_pass}"

        # Correct password should still work
        authenticated = authenticate_user(db_session, "test@example.com", "correctpass")
        assert authenticated is not None, "Correct password should authenticate"

    def test_session_security_multiple_users(self, db_session):
        """
        Verify session security with multiple concurrent users.
        """
        # Create multiple users
        users = []
        tokens = []
        histories = []

        for i in range(5):
            user_data = UserCreate(email=f"user{i}@example.com", password=f"pass{i}")
            user = create_user(db_session, user_data)
            users.append(user)

            # Create token for each user
            token = create_access_token({"sub": user.id})
            tokens.append(token)

            # Create history for each user
            history_data = ChatHistoryCreate(title=f"User {i} Chat", messages=[])
            history = create_chat_history(db_session, user.id, history_data)
            histories.append(history)

        # Verify each user can only access their own data
        for i, user in enumerate(users):
            # User should be able to access their own history
            own_history = get_chat_history(db_session, histories[i].id, user.id)
            assert own_history is not None
            assert own_history.user_id == user.id

            # User should not be able to access other users' histories
            for j, other_history in enumerate(histories):
                if i != j:
                    other = get_chat_history(db_session, other_history.id, user.id)
                    assert other is None, f"User {i} should not access User {j}'s history"

    def test_data_isolation_after_user_deletion(self, db_session):
        """
        Verify that user data isolation is maintained even after cascading deletes.

        When a user is deleted, all their histories should be deleted too,
        and other users' data should remain intact.
        """
        # Create two users with histories
        user_a = create_user(db_session, UserCreate(email="usera@example.com", password="pass"))
        user_b = create_user(db_session, UserCreate(email="userb@example.com", password="pass"))

        history_a = create_chat_history(
            db_session, user_a.id,
            ChatHistoryCreate(title="User A Chat", messages=[])
        )
        history_b = create_chat_history(
            db_session, user_b.id,
            ChatHistoryCreate(title="User B Chat", messages=[])
        )

        # Verify both histories exist
        assert get_chat_history(db_session, history_a.id, user_a.id) is not None
        assert get_chat_history(db_session, history_b.id, user_b.id) is not None

        # Delete User A (cascade should delete User A's history)
        db_session.delete(user_a)
        db_session.commit()

        # User A's history should be gone
        assert get_chat_history(db_session, history_a.id, user_a.id) is None

        # User B's history should still exist
        assert get_chat_history(db_session, history_b.id, user_b.id) is not None

        # Verify User B still can't access User A's deleted history
        assert get_chat_history(db_session, history_a.id, user_b.id) is None
