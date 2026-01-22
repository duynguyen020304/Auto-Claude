#!/usr/bin/env python3
"""
Unit tests for inclusive_limit_calculation() function.

Tests the inclusive task limit calculation that counts both pooled and
non-pooled tasks using a credential pool's resources.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from core.rotation import (
    _get_non_pooled_task_count_using_profiles,
    _get_pooled_task_count,
    inclusive_limit_calculation,
)


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def mock_pool():
    """Create a mock credential pool configuration."""
    return {
        "id": "test-pool",
        "name": "Test Pool",
        "profile_ids": ["cred-001", "cred-002", "cred-003"],
        "max_tasks": 10,
    }


@pytest.fixture
def mock_pool_with_no_profiles():
    """Create a mock pool with no profiles."""
    return {
        "id": "empty-pool",
        "name": "Empty Pool",
        "profile_ids": [],
        "max_tasks": 10,
    }


# =============================================================================
# inclusive_limit_calculation() Tests
# =============================================================================


class TestInclusiveLimitCalculation:
    """Test suite for inclusive_limit_calculation() function."""

    @patch("core.auth.get_pool")
    def test_pool_not_found_returns_zero(self, mock_get_pool):
        """Test that calculation returns 0 when pool is not found."""
        mock_get_pool.return_value = None

        result = inclusive_limit_calculation("non-existent-pool")

        assert result == 0
        mock_get_pool.assert_called_once_with("non-existent-pool")

    @patch("core.auth.get_pool")
    def test_pool_with_no_profiles_returns_zero(self, mock_get_pool, mock_pool_with_no_profiles):
        """Test that calculation returns 0 when pool has no profiles."""
        mock_get_pool.return_value = mock_pool_with_no_profiles

        result = inclusive_limit_calculation("empty-pool")

        assert result == 0
        mock_get_pool.assert_called_once_with("empty-pool")

    @patch("core.rotation._get_pooled_task_count")
    @patch("core.rotation._get_non_pooled_task_count_using_profiles")
    @patch("core.auth.get_pool")
    def test_only_pooled_tasks(
        self, mock_get_pool, mock_get_non_pooled, mock_get_pooled, mock_pool
    ):
        """Test calculation with only pooled tasks (no non-pooled using profiles)."""
        mock_get_pool.return_value = mock_pool
        mock_get_pooled.return_value = 5
        mock_get_non_pooled.return_value = 0

        result = inclusive_limit_calculation("test-pool")

        assert result == 5
        mock_get_pooled.assert_called_once_with("test-pool")
        mock_get_non_pooled.assert_called_once_with(
            "test-pool", mock_pool["profile_ids"]
        )

    @patch("core.rotation._get_pooled_task_count")
    @patch("core.rotation._get_non_pooled_task_count_using_profiles")
    @patch("core.auth.get_pool")
    def test_only_non_pooled_tasks(
        self, mock_get_pool, mock_get_non_pooled, mock_get_pooled, mock_pool
    ):
        """Test calculation with only non-pooled tasks using pool's profiles."""
        mock_get_pool.return_value = mock_pool
        mock_get_pooled.return_value = 0
        mock_get_non_pooled.return_value = 3

        result = inclusive_limit_calculation("test-pool")

        assert result == 3
        mock_get_pooled.assert_called_once_with("test-pool")
        mock_get_non_pooled.assert_called_once_with(
            "test-pool", mock_pool["profile_ids"]
        )

    @patch("core.rotation._get_pooled_task_count")
    @patch("core.rotation._get_non_pooled_task_count_using_profiles")
    @patch("core.auth.get_pool")
    def test_both_pooled_and_non_pooled_tasks(
        self, mock_get_pool, mock_get_non_pooled, mock_get_pooled, mock_pool
    ):
        """Test calculation with both pooled and non-pooled tasks."""
        mock_get_pool.return_value = mock_pool
        mock_get_pooled.return_value = 5
        mock_get_non_pooled.return_value = 3

        result = inclusive_limit_calculation("test-pool")

        assert result == 8  # 5 pooled + 3 non-pooled
        mock_get_pooled.assert_called_once_with("test-pool")
        mock_get_non_pooled.assert_called_once_with(
            "test-pool", mock_pool["profile_ids"]
        )

    @patch("core.rotation._get_pooled_task_count")
    @patch("core.rotation._get_non_pooled_task_count_using_profiles")
    @patch("core.auth.get_pool")
    def test_large_task_counts(
        self, mock_get_pool, mock_get_non_pooled, mock_get_pooled, mock_pool
    ):
        """Test calculation with large task counts."""
        mock_get_pool.return_value = mock_pool
        mock_get_pooled.return_value = 100
        mock_get_non_pooled.return_value = 50

        result = inclusive_limit_calculation("test-pool")

        assert result == 150  # 100 pooled + 50 non-pooled

    @patch("core.auth.get_pool")
    def test_exception_handling_returns_zero(self, mock_get_pool):
        """Test that exceptions are caught and return 0."""
        mock_get_pool.side_effect = Exception("Database error")

        result = inclusive_limit_calculation("test-pool")

        assert result == 0

    @patch("core.rotation._get_pooled_task_count")
    @patch("core.rotation._get_non_pooled_task_count_using_profiles")
    @patch("core.auth.get_pool")
    def test_get_pool_called_with_correct_pool_id(
        self, mock_get_pool, mock_get_non_pooled, mock_get_pooled, mock_pool
    ):
        """Test that get_pool is called with the correct pool_id."""
        mock_get_pool.return_value = mock_pool
        mock_get_pooled.return_value = 0
        mock_get_non_pooled.return_value = 0

        pool_id = "my-custom-pool"
        result = inclusive_limit_calculation(pool_id)

        mock_get_pool.assert_called_once_with(pool_id)
        assert result == 0

    @patch("core.rotation._get_pooled_task_count")
    @patch("core.rotation._get_non_pooled_task_count_using_profiles")
    @patch("core.auth.get_pool")
    def test_profile_ids_passed_correctly_to_non_pooled_counter(
        self, mock_get_pool, mock_get_non_pooled, mock_get_pooled, mock_pool
    ):
        """Test that profile_ids from pool are passed to non-pooled counter."""
        mock_get_pool.return_value = mock_pool
        mock_get_pooled.return_value = 0
        mock_get_non_pooled.return_value = 0

        inclusive_limit_calculation("test-pool")

        # Verify the profile_ids list was passed correctly
        mock_get_non_pooled.assert_called_once_with(
            "test-pool", mock_pool["profile_ids"]
        )
        assert mock_get_non_pooled.call_args[0][1] == ["cred-001", "cred-002", "cred-003"]


# =============================================================================
# _get_pooled_task_count() Tests
# =============================================================================


class TestGetPooledTaskCount:
    """Test suite for _get_pooled_task_count() helper function."""

    @patch("core.rotation._get_pooled_task_count")
    def test_placeholder_returns_zero(self, mock_func):
        """Test that placeholder implementation returns 0."""
        # This test documents current behavior
        # When task storage is implemented, this will change
        mock_func.return_value = 0

        result = _get_pooled_task_count("test-pool")

        assert result == 0

    def test_returns_zero_without_mock(self):
        """Test that function returns 0 (placeholder behavior)."""
        result = _get_pooled_task_count("test-pool")
        assert result == 0


# =============================================================================
# _get_non_pooled_task_count_using_profiles() Tests
# =============================================================================


class TestGetNonPooledTaskCountUsingProfiles:
    """Test suite for _get_non_pooled_task_count_using_profiles() helper function."""

    def test_returns_zero_without_mock(self):
        """Test that function returns 0 (placeholder behavior)."""
        profile_ids = ["cred-001", "cred-002", "cred-003"]
        result = _get_non_pooled_task_count_using_profiles("test-pool", profile_ids)
        assert result == 0

    def test_with_empty_profile_ids(self):
        """Test behavior with empty profile_ids list."""
        profile_ids = []
        result = _get_non_pooled_task_count_using_profiles("test-pool", profile_ids)
        assert result == 0

    def test_with_single_profile_id(self):
        """Test behavior with single profile ID."""
        profile_ids = ["cred-001"]
        result = _get_non_pooled_task_count_using_profiles("test-pool", profile_ids)
        assert result == 0

    def test_with_many_profile_ids(self):
        """Test behavior with many profile IDs."""
        profile_ids = [f"cred-{i:03d}" for i in range(1, 11)]  # 10 profiles
        result = _get_non_pooled_task_count_using_profiles("test-pool", profile_ids)
        assert result == 0


# =============================================================================
# Run Tests
# =============================================================================


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
