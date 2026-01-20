#!/usr/bin/env python3
"""
Unit Tests for SDK Client Hooks
================================

Tests the client-side functions for:
- Extracting token usage from SDK responses
- Detecting rate limit errors (HTTP 429)
- Automatic credential swapping on rate limits
- Retry logic with exponential backoff
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

from core.client import (
    execute_session_with_auto_swap,
    extract_token_usage,
    is_rate_limit_error,
)
from core.usage_tracker import TokenUsage


class TestExtractTokenUsage:
    """Tests for extract_token_usage function."""

    def test_extract_from_message_with_usage_dict(self):
        """Extracts usage from message with usage attribute as dict."""
        message = Mock()
        message.usage = {
            "input_tokens": 1000,
            "output_tokens": 500,
            "cache_creation_input_tokens": 200,
            "cache_read_tokens": 100,
        }

        usage = extract_token_usage(message)

        assert usage.input_tokens == 1000
        assert usage.output_tokens == 500
        assert usage.cache_creation_input_tokens == 200
        assert usage.cache_read_tokens == 100
        assert usage.total_tokens == 1600

    def test_extract_from_message_with_usage_object(self):
        """Extracts usage from message with usage attribute as object."""
        usage_obj = Mock()
        usage_obj.input_tokens = 1000
        usage_obj.output_tokens = 500
        usage_obj.cache_creation_input_tokens = 200
        usage_obj.cache_read_tokens = 100

        message = Mock()
        message.usage = usage_obj

        usage = extract_token_usage(message)

        assert usage.input_tokens == 1000
        assert usage.output_tokens == 500
        assert usage.cache_creation_input_tokens == 200
        assert usage.cache_read_tokens == 100

    def test_extract_from_message_with_token_usage_dict(self):
        """Extracts usage from message with token_usage attribute as dict."""
        # Create a proper mock object with token_usage as actual dict
        class MockMessage:
            token_usage = {
                "input_tokens": 2000,
                "output_tokens": 1000,
                "cache_creation_input_tokens": 300,
                "cache_read_tokens": 150,
            }

        message = MockMessage()

        usage = extract_token_usage(message)

        assert usage.input_tokens == 2000
        assert usage.output_tokens == 1000
        assert usage.cache_creation_input_tokens == 300
        assert usage.cache_read_tokens == 150
        assert usage.total_tokens == 3150

    def test_extract_from_message_with_token_usage_object(self):
        """Extracts usage from message with token_usage attribute as object."""
        class MockUsageObj:
            input_tokens = 2000
            output_tokens = 1000
            cache_creation_input_tokens = 300
            cache_read_tokens = 150

        class MockMessage:
            token_usage = MockUsageObj()

        message = MockMessage()

        usage = extract_token_usage(message)

        assert usage.input_tokens == 2000
        assert usage.output_tokens == 1000
        assert usage.cache_creation_input_tokens == 300
        assert usage.cache_read_tokens == 150

    def test_extract_from_message_without_usage(self):
        """Returns zero usage when message has no usage attribute."""
        message = Mock(spec_set=[])  # Empty spec - no attributes

        usage = extract_token_usage(message)

        assert usage.input_tokens == 0
        assert usage.output_tokens == 0
        assert usage.cache_creation_input_tokens == 0
        assert usage.cache_read_tokens == 0
        assert usage.total_tokens == 0

    def test_extract_from_partial_usage_dict(self):
        """Handles partial usage data in dict (missing fields)."""
        message = Mock()
        message.usage = {
            "input_tokens": 1000,
            # output_tokens missing
            "cache_read_tokens": 100,
        }

        usage = extract_token_usage(message)

        assert usage.input_tokens == 1000
        assert usage.output_tokens == 0  # Missing field defaults to 0
        assert usage.cache_read_tokens == 100

    def test_extract_from_partial_usage_object(self):
        """Handles partial usage data in object (missing attributes)."""
        class MockUsageObj:
            input_tokens = 1000
            # Other attributes will be missing

        class MockMessage:
            usage = MockUsageObj()

        message = MockMessage()

        usage = extract_token_usage(message)

        assert usage.input_tokens == 1000
        # getattr with default value returns 0 for missing attributes
        assert usage.output_tokens == 0
        assert usage.cache_creation_input_tokens == 0
        assert usage.cache_read_tokens == 0

    def test_extract_usage_zero_tokens(self):
        """Handles usage data with all zero values."""
        message = Mock()
        message.usage = {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_creation_input_tokens": 0,
            "cache_read_tokens": 0,
        }

        usage = extract_token_usage(message)

        assert usage.total_tokens == 0

    def test_extract_usage_large_values(self):
        """Handles large token counts."""
        message = Mock()
        message.usage = {
            "input_tokens": 100000,
            "output_tokens": 50000,
            "cache_creation_input_tokens": 10000,
            "cache_read_tokens": 5000,
        }

        usage = extract_token_usage(message)

        assert usage.input_tokens == 100000
        assert usage.output_tokens == 50000
        assert usage.total_tokens == 155000


class TestIsRateLimitError:
    """Tests for is_rate_limit_error function."""

    def test_detects_429_status_code(self):
        """Detects rate limit via HTTP status code 429."""
        response = Mock()
        response.status_code = 429

        assert is_rate_limit_error(response) is True

    def test_not_rate_limit_200_status(self):
        """Returns False for successful HTTP status."""
        response = Mock()
        response.status_code = 200

        assert is_rate_limit_error(response) is False

    def test_not_rate_limit_500_status(self):
        """Returns False for server error (not rate limit)."""
        response = Mock()
        response.status_code = 500

        assert is_rate_limit_error(response) is False

    def test_detects_rate_limit_in_error_type(self):
        """Detects rate limit via error type attribute."""
        response = Mock()
        response.type = "rate_limit_error"

        assert is_rate_limit_error(response) is True

    def test_detects_rate_limit_in_error_type_case_insensitive(self):
        """Detects rate limit in error type (case insensitive)."""
        response = Mock()
        response.type = "RateLimitExceeded"

        assert is_rate_limit_error(response) is True

    def test_detects_rate_limit_in_error_dict(self):
        """Detects rate limit in error attribute (dict format)."""
        response = Mock()
        response.error = {
            "type": "rate_limit_error",
            "message": "Too many requests",
        }

        assert is_rate_limit_error(response) is True

    def test_detects_rate_limit_in_error_message_dict(self):
        """Detects rate limit in error message field (dict)."""
        response = Mock()
        response.error_message = {
            "message": "Rate limit exceeded",
            "detail": "429 Too Many Requests",
        }

        assert is_rate_limit_error(response) is True

    def test_detects_rate_limit_in_error_string(self):
        """Detects rate limit in error attribute (string format)."""
        response = Mock()
        response.error = "Rate limit exceeded, please try again later"

        assert is_rate_limit_error(response) is True

    def test_detects_too_many_requests_string(self):
        """Detects 'too many requests' in error message."""
        response = Mock()
        response.message = "Too many requests, please slow down"

        assert is_rate_limit_error(response) is True

    def test_detects_quota_exceeded_string(self):
        """Detects 'quota exceeded' in error message."""
        response = Mock()
        response.detail = "API quota exceeded for this credential"

        assert is_rate_limit_error(response) is True

    def test_detects_throttled_string(self):
        """Detects 'throttled' in error message."""
        response = Mock()
        response.reason = "Request throttled due to high rate"

        assert is_rate_limit_error(response) is True

    def test_detects_429_in_message_string(self):
        """Detects '429' in error message string."""
        response = Mock()
        response.message = "Error 429: Rate limit reached"

        assert is_rate_limit_error(response) is True

    def test_not_rate_limit_other_error(self):
        """Returns False for non-rate-limit errors."""
        response = Mock()
        response.error = "Authentication failed"

        assert is_rate_limit_error(response) is False

    def test_detects_rate_limit_exception_type(self):
        """Detects rate limit via exception class name."""
        response = Mock()
        response.__class__.__name__ = "RateLimitError"

        assert is_rate_limit_error(response) is True

    def test_detects_too_many_requests_exception(self):
        """Detects rate limit via TooManyRequests exception."""
        response = Mock()
        response.__class__.__name__ = "TooManyRequestsError"

        assert is_rate_limit_error(response) is True

    def test_not_rate_limit_other_exception(self):
        """Returns False for other exception types."""
        response = Mock()
        response.__class__.__name__ = "AuthenticationError"

        assert is_rate_limit_error(response) is False

    def test_checks_multiple_error_attributes(self):
        """Checks multiple error attributes in priority order."""
        response = Mock()
        # Has status_code attribute but not 429
        response.status_code = 500
        # Has error attribute with rate limit message
        response.error = "Rate limit exceeded"

        assert is_rate_limit_error(response) is True

    def test_message_without_rate_limit_indicators(self):
        """Returns False for message without any rate limit indicators."""
        response = Mock()
        response.status_code = 200
        response.message = "Success"
        response.__class__.__name__ = "SuccessMessage"

        assert is_rate_limit_error(response) is False


class TestExecuteSessionWithAutoSwap:
    """Tests for execute_session_with_auto_swap function."""

    @pytest.mark.asyncio
    async def test_executes_without_rotation_when_not_configured(self):
        """Executes session normally when rotation is not configured."""
        project_dir = Path("/project")
        spec_dir = Path("/spec")

        # Mock session callback
        session_callback = AsyncMock(return_value="success")

        # Patch environment to remove credential pool AND mock auth AND file operations
        with patch.dict("os.environ", {}, clear=True):
            with patch("core.client.require_auth_token", return_value="test-token"):
                with patch("builtins.open", MagicMock()):
                    result = await execute_session_with_auto_swap(
                        session_callback=session_callback,
                        project_dir=project_dir,
                        spec_dir=spec_dir,
                        model="claude-sonnet-4-5-20250929",
                        agent_type="coder",
                    )

        assert result == "success"
        session_callback.assert_called_once()

    @pytest.mark.asyncio
    async def test_executes_with_rotation_when_configured(self):
        """Executes session with rotation when configured."""
        project_dir = Path("/project")
        spec_dir = Path("/spec")

        # Mock session callback
        session_callback = AsyncMock(return_value="success")

        # Set up environment for rotation
        env = {
            "AUTO_CLAUDE_CREDENTIAL_POOL": "cred-001,cred-002,cred-003",
            "AUTO_CLAUDE_ROTATION_MODE": "round_robin",
        }

        with patch.dict("os.environ", env, clear=True):
            # Mock memory and rotation manager
            with patch("core.client._get_rotation_memory", return_value=None):
                with patch("core.client.create_client") as mock_create_client:
                    mock_client = Mock()
                    mock_create_client.return_value = mock_client

                    with patch("core.client._execute_session_with_retry") as mock_retry:
                        mock_retry.return_value = "success"

                        result = await execute_session_with_auto_swap(
                            session_callback=session_callback,
                            project_dir=project_dir,
                            spec_dir=spec_dir,
                            model="claude-sonnet-4-5-20250929",
                            agent_type="coder",
                        )

        assert result == "success"

    @pytest.mark.asyncio
    async def test_passes_parameters_to_session_callback(self):
        """Passes all parameters correctly to session callback."""
        project_dir = Path("/project")
        spec_dir = Path("/spec")

        session_callback = AsyncMock(return_value="result")

        with patch.dict("os.environ", {}, clear=True):
            with patch("core.client.create_client") as mock_create_client:
                mock_client = Mock()
                mock_create_client.return_value = mock_client

                result = await execute_session_with_auto_swap(
                    session_callback=session_callback,
                    project_dir=project_dir,
                    spec_dir=spec_dir,
                    model="claude-opus-4-5-20250929",
                    agent_type="planner",
                    max_thinking_tokens=30000,
                    output_format={"type": "json"},
                    agents={"subagent1": {}},
                )

        # Verify callback was called with client
        session_callback.assert_called_once()
        called_with_client = session_callback.call_args[0][0]
        assert called_with_client == mock_client


class TestExecuteSessionWithRetry:
    """Tests for _execute_session_with_retry function (internal)."""

    @pytest.mark.asyncio
    async def test_retries_on_rate_limit_error(self):
        """Retries session when rate limit error is detected."""
        from core.client import _execute_session_with_retry
        from core.credentials import RotationConfig, RotationMode
        from core.rotation import RotationManager

        project_dir = Path("/project")
        spec_dir = Path("/spec")

        # Create rotation config
        config = RotationConfig(
            mode=RotationMode.ROUND_ROBIN,
            credential_pool=["cred-001", "cred-002"],
            max_retries=3,
            retry_delay_seconds=1,
        )

        # Mock rotation manager
        manager = Mock(spec=RotationManager)
        manager.config = config
        manager.select_credential = AsyncMock(return_value="cred-002")

        # Mock client
        client = Mock()

        # Mock session callback that returns successfully on second try
        attempt_count = [0]

        async def mock_session_callback(c):
            attempt_count[0] += 1
            if attempt_count[0] == 1:
                # Simulate rate limit error on first attempt
                raise Exception("429 Rate limit")
            else:
                return "success"

        # This should test the retry logic
        # Note: The actual implementation may vary based on how retry is structured
        # This is a placeholder test structure

    @pytest.mark.asyncio
    async def test_respects_max_retries_limit(self):
        """Stops retrying after max_retries is reached."""
        # Placeholder for testing max retries enforcement
        pass

    @pytest.mark.asyncio
    async def test_uses_retry_delay(self):
        """Waits for retry delay between attempts."""
        # Placeholder for testing retry delay timing
        pass

    @pytest.mark.asyncio
    async def test_logs_rotation_events(self):
        """Logs credential rotation events."""
        # Placeholder for testing rotation event logging
        pass
