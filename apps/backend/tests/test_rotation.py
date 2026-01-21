#!/usr/bin/env python3
"""
Unit tests for credential rotation strategies.

Tests the rotation strategy implementations:
- ManualRotationStrategy
- RoundRobinRotationStrategy
- UsageBasedRotationStrategy
- RateLimitAwareRotationStrategy
- StrategyRegistry
- RotationManager
"""

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from core.credentials import (
    CredentialProfile,
    CredentialStatus,
    CredentialType,
    RotationConfig,
    RotationMode,
)
from core.rotation import (
    ManualRotationStrategy,
    RateLimitAwareRotationStrategy,
    RotationContext,
    RotationManager,
    RoundRobinRotationStrategy,
    UsageBasedRotationStrategy,
    get_strategy_registry,
)


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def mock_credentials():
    """Create mock credential profiles for testing."""
    credentials = [
        CredentialProfile(
            id="cred-001",
            name="Credential 1",
            type=CredentialType.API_KEY,
            credential_value="sk-test-001",
            status=CredentialStatus.ACTIVE,
        ),
        CredentialProfile(
            id="cred-002",
            name="Credential 2",
            type=CredentialType.API_KEY,
            credential_value="sk-test-002",
            status=CredentialStatus.ACTIVE,
        ),
        CredentialProfile(
            id="cred-003",
            name="Credential 3",
            type=CredentialType.API_KEY,
            credential_value="sk-test-003",
            status=CredentialStatus.ACTIVE,
        ),
    ]
    return credentials


@pytest.fixture
def mock_rotation_config():
    """Create a mock rotation configuration."""
    return RotationConfig(
        mode=RotationMode.ROUND_ROBIN,
        credential_pool=["cred-001", "cred-002", "cred-003"],
        rate_limit_threshold=0.8,
    )


@pytest.fixture
def mock_rotation_context():
    """Create a mock rotation context."""
    return RotationContext(
        current_credential_id=None,
        memory=None,
        task_id="test-task",
        request_count=0,
    )


@pytest.fixture
def mock_memory():
    """Create a mock Graphiti memory instance."""
    memory = MagicMock()
    memory.is_enabled = False
    return memory


# =============================================================================
# ManualRotationStrategy Tests
# =============================================================================


class TestManualRotationStrategy:
    """Test suite for ManualRotationStrategy."""

    def test_init(self):
        """Test ManualRotationStrategy initialization."""
        strategy = ManualRotationStrategy()
        assert strategy.get_mode() == RotationMode.MANUAL
        assert strategy.get_selected_credential() is None

    def test_select_from_config(self, mock_credentials, mock_rotation_config, mock_rotation_context):
        """Test selection from config.manual_credential_id."""
        strategy = ManualRotationStrategy()

        # Set config to select specific credential
        mock_rotation_config.manual_credential_id = "cred-002"

        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        assert selected is not None
        assert selected.id == "cred-002"

    def test_select_from_environment(self, mock_credentials, mock_rotation_config, mock_rotation_context):
        """Test selection from environment variable."""
        strategy = ManualRotationStrategy()

        # Set environment variable
        with patch.dict(os.environ, {"AUTO_CLAUDE_CREDENTIAL_ID": "cred-003"}):
            selected = strategy.select_credential(
                pool=mock_credentials,
                config=mock_rotation_config,
                context=mock_rotation_context,
            )

            assert selected is not None
            assert selected.id == "cred-003"

    def test_select_fallback_to_first(self, mock_credentials, mock_rotation_config, mock_rotation_context):
        """Test fallback to first active credential when no config/env set."""
        strategy = ManualRotationStrategy()

        # No config or environment variable set
        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        assert selected is not None
        assert selected.id == "cred-001"  # First active credential

    def test_select_filters_disabled(self, mock_rotation_config, mock_rotation_context):
        """Test that disabled credentials are filtered out."""
        strategy = ManualRotationStrategy()

        # Create credentials with one disabled
        credentials = [
            CredentialProfile(
                id="cred-001",
                name="Credential 1",
                type=CredentialType.API_KEY,
                credential_value="sk-test-001",
                status=CredentialStatus.DISABLED,
            ),
            CredentialProfile(
                id="cred-002",
                name="Credential 2",
                type=CredentialType.API_KEY,
                credential_value="sk-test-002",
                status=CredentialStatus.ACTIVE,
            ),
        ]

        mock_rotation_config.manual_credential_id = "cred-001"  # Try to select disabled

        selected = strategy.select_credential(
            pool=credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        # Should not select the disabled credential, fall back to first active
        assert selected is not None
        assert selected.id == "cred-002"

    def test_select_empty_pool_raises_error(self, mock_rotation_config, mock_rotation_context):
        """Test that empty pool raises ValueError."""
        strategy = ManualRotationStrategy()

        with pytest.raises(ValueError, match="Credential pool is empty"):
            strategy.select_credential(
                pool=[],
                config=mock_rotation_config,
                context=mock_rotation_context,
            )

    def test_select_no_active_credentials(self, mock_rotation_config, mock_rotation_context):
        """Test behavior when all credentials are inactive."""
        strategy = ManualRotationStrategy()

        # All credentials disabled
        credentials = [
            CredentialProfile(
                id="cred-001",
                name="Credential 1",
                type=CredentialType.API_KEY,
                credential_value="sk-test-001",
                status=CredentialStatus.DISABLED,
            ),
        ]

        selected = strategy.select_credential(
            pool=credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        assert selected is None

    def test_set_credential(self):
        """Test programmatic credential selection."""
        strategy = ManualRotationStrategy()
        strategy.set_credential("test-cred-id")
        assert strategy.get_selected_credential() == "test-cred-id"


# =============================================================================
# RoundRobinRotationStrategy Tests
# =============================================================================


class TestRoundRobinRotationStrategy:
    """Test suite for RoundRobinRotationStrategy."""

    def test_init(self):
        """Test RoundRobinRotationStrategy initialization."""
        strategy = RoundRobinRotationStrategy()
        assert strategy.get_mode() == RotationMode.ROUND_ROBIN
        assert strategy.get_current_index() == 0

    def test_sequential_selection(self, mock_credentials, mock_rotation_config, mock_rotation_context):
        """Test that credentials are selected sequentially."""
        strategy = RoundRobinRotationStrategy()

        # First selection
        selected1 = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )
        assert selected1.id == "cred-001"
        assert strategy.get_current_index() == 1

        # Second selection
        selected2 = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )
        assert selected2.id == "cred-002"
        assert strategy.get_current_index() == 2

        # Third selection
        selected3 = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )
        assert selected3.id == "cred-003"
        assert strategy.get_current_index() == 0  # Wrapped around

    def test_wraparound(self, mock_credentials, mock_rotation_config, mock_rotation_context):
        """Test that selection wraps around to beginning."""
        strategy = RoundRobinRotationStrategy()

        # Select through all credentials
        selections = []
        for i in range(6):  # Two full cycles
            selected = strategy.select_credential(
                pool=mock_credentials,
                config=mock_rotation_config,
                context=mock_rotation_context,
            )
            selections.append(selected.id)

        # Verify pattern: 001, 002, 003, 001, 002, 003
        assert selections == ["cred-001", "cred-002", "cred-003", "cred-001", "cred-002", "cred-003"]

    def test_filters_inactive_credentials(self, mock_rotation_config, mock_rotation_context):
        """Test that inactive credentials are skipped."""
        strategy = RoundRobinRotationStrategy()

        # Create credentials with one rate-limited
        credentials = [
            CredentialProfile(
                id="cred-001",
                name="Credential 1",
                type=CredentialType.API_KEY,
                credential_value="sk-test-001",
                status=CredentialStatus.ACTIVE,
            ),
            CredentialProfile(
                id="cred-002",
                name="Credential 2",
                type=CredentialType.API_KEY,
                credential_value="sk-test-002",
                status=CredentialStatus.RATE_LIMITED,
            ),
            CredentialProfile(
                id="cred-003",
                name="Credential 3",
                type=CredentialType.API_KEY,
                credential_value="sk-test-003",
                status=CredentialStatus.ACTIVE,
            ),
        ]

        # Should only cycle through active credentials (001, 003)
        selected1 = strategy.select_credential(
            pool=credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )
        assert selected1.id == "cred-001"

        selected2 = strategy.select_credential(
            pool=credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )
        assert selected2.id == "cred-003"  # Skipped 002

        selected3 = strategy.select_credential(
            pool=credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )
        assert selected3.id == "cred-001"  # Wrapped back

    def test_reset_index(self, mock_credentials, mock_rotation_config, mock_rotation_context):
        """Test index reset functionality."""
        strategy = RoundRobinRotationStrategy()

        # Make a few selections
        strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )
        strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )
        assert strategy.get_current_index() == 2

        # Reset
        strategy.reset_index()
        assert strategy.get_current_index() == 0

        # Next selection should start from beginning
        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )
        assert selected.id == "cred-001"

    def test_set_index(self):
        """Test setting index to specific value."""
        strategy = RoundRobinRotationStrategy()

        strategy.set_index(2)
        assert strategy.get_current_index() == 2

        strategy.set_index(0)
        assert strategy.get_current_index() == 0

    def test_set_negative_index_raises_error(self):
        """Test that negative index raises ValueError."""
        strategy = RoundRobinRotationStrategy()

        with pytest.raises(ValueError, match="Index must be non-negative"):
            strategy.set_index(-1)

    def test_empty_pool_raises_error(self, mock_rotation_config, mock_rotation_context):
        """Test that empty pool raises ValueError."""
        strategy = RoundRobinRotationStrategy()

        with pytest.raises(ValueError, match="Credential pool is empty"):
            strategy.select_credential(
                pool=[],
                config=mock_rotation_config,
                context=mock_rotation_context,
            )


# =============================================================================
# UsageBasedRotationStrategy Tests
# =============================================================================


class TestUsageBasedRotationStrategy:
    """Test suite for UsageBasedRotationStrategy."""

    def test_init(self):
        """Test UsageBasedRotationStrategy initialization."""
        strategy = UsageBasedRotationStrategy()
        assert strategy.get_mode() == RotationMode.USAGE_BASED

    def test_select_without_memory_fallback(self, mock_credentials, mock_rotation_config, mock_rotation_context):
        """Test fallback to first credential when memory is disabled."""
        strategy = UsageBasedRotationStrategy()
        mock_rotation_context.memory = None

        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        assert selected is not None
        assert selected.id == "cred-001"  # First active credential

    def test_select_with_memory_disabled(self, mock_credentials, mock_rotation_config, mock_rotation_context, mock_memory):
        """Test behavior when memory is available but disabled."""
        strategy = UsageBasedRotationStrategy()
        mock_rotation_context.memory = mock_memory
        mock_memory.is_enabled = False

        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        assert selected is not None
        assert selected.id == "cred-001"  # Fallback to first

    def test_select_with_memory_enabled(self, mock_credentials, mock_rotation_config, mock_rotation_context, mock_memory):
        """Test selection with Graphiti memory enabled."""
        strategy = UsageBasedRotationStrategy()
        mock_rotation_context.memory = mock_memory
        mock_memory.is_enabled = True

        # Mock get_least_used_credential as an async function that returns cred-003
        async def mock_get_least_used(credential_ids):
            return "cred-003"

        mock_memory.get_least_used_credential = AsyncMock(side_effect=mock_get_least_used)

        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        assert selected is not None
        assert selected.id == "cred-003"
        mock_memory.get_least_used_credential.assert_called_once()

    def test_select_memory_returns_none_fallback(self, mock_credentials, mock_rotation_config, mock_rotation_context, mock_memory):
        """Test fallback when memory returns None."""
        strategy = UsageBasedRotationStrategy()
        mock_rotation_context.memory = mock_memory
        mock_memory.is_enabled = True

        # Mock get_least_used_credential to return None (no usage data)
        async def mock_get_least_used_none(credential_ids):
            return None

        mock_memory.get_least_used_credential = AsyncMock(side_effect=mock_get_least_used_none)

        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        assert selected is not None
        assert selected.id == "cred-001"  # Fallback

    def test_select_memory_exception_fallback(self, mock_credentials, mock_rotation_config, mock_rotation_context, mock_memory):
        """Test fallback when memory query raises exception."""
        strategy = UsageBasedRotationStrategy()
        mock_rotation_context.memory = mock_memory
        mock_memory.is_enabled = True

        # Mock get_least_used_credential to raise exception
        async def mock_get_least_used_error(credential_ids):
            raise Exception("Memory error")

        mock_memory.get_least_used_credential = AsyncMock(side_effect=mock_get_least_used_error)

        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        assert selected is not None
        assert selected.id == "cred-001"  # Fallback

    def test_filters_inactive_credentials(self, mock_rotation_config, mock_rotation_context):
        """Test that inactive credentials are filtered."""
        strategy = UsageBasedRotationStrategy()

        credentials = [
            CredentialProfile(
                id="cred-001",
                name="Credential 1",
                type=CredentialType.API_KEY,
                credential_value="sk-test-001",
                status=CredentialStatus.ACTIVE,
            ),
            CredentialProfile(
                id="cred-002",
                name="Credential 2",
                type=CredentialType.API_KEY,
                credential_value="sk-test-002",
                status=CredentialStatus.DISABLED,
            ),
        ]

        selected = strategy.select_credential(
            pool=credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        # Should only select from active pool (cred-001)
        assert selected is not None
        assert selected.id == "cred-001"


# =============================================================================
# RateLimitAwareRotationStrategy Tests
# =============================================================================


class TestRateLimitAwareRotationStrategy:
    """Test suite for RateLimitAwareRotationStrategy."""

    def test_init(self):
        """Test RateLimitAwareRotationStrategy initialization."""
        strategy = RateLimitAwareRotationStrategy()
        assert strategy.get_mode() == RotationMode.RATE_LIMIT_AWARE

    def test_select_without_memory_fallback(self, mock_credentials, mock_rotation_config, mock_rotation_context):
        """Test fallback to first credential when memory is disabled."""
        strategy = RateLimitAwareRotationStrategy()
        mock_rotation_context.memory = None

        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        assert selected is not None
        assert selected.id == "cred-001"

    def test_select_with_memory_disabled(self, mock_credentials, mock_rotation_config, mock_rotation_context, mock_memory):
        """Test behavior when memory is available but disabled."""
        strategy = RateLimitAwareRotationStrategy()
        mock_rotation_context.memory = mock_memory
        mock_memory.is_enabled = False

        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        assert selected is not None
        assert selected.id == "cred-001"

    def test_select_with_usage_data(self, mock_credentials, mock_rotation_config, mock_rotation_context, mock_memory):
        """Test selection with usage data from memory."""
        strategy = RateLimitAwareRotationStrategy()
        mock_rotation_context.memory = mock_memory
        mock_memory.is_enabled = True

        # Mock get_credential_usage to return different usage levels
        async def mock_get_usage(cred_id):
            usage_map = {
                "cred-001": {"total_tokens": 150_000},  # 75% of default limit
                "cred-002": {"total_tokens": 50_000},   # 25% of default limit
                "cred-003": {"total_tokens": 100_000},  # 50% of default limit
            }
            return usage_map.get(cred_id, {"total_tokens": 0})

        mock_memory.get_credential_usage = AsyncMock(side_effect=mock_get_usage)

        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        # Should select cred-002 (lowest usage ratio: 25%)
        assert selected is not None
        assert selected.id == "cred-002"

    def test_select_all_above_threshold(self, mock_credentials, mock_rotation_config, mock_rotation_context, mock_memory):
        """Test selection when all credentials are above threshold."""
        strategy = RateLimitAwareRotationStrategy()
        mock_rotation_context.memory = mock_memory
        mock_memory.is_enabled = True

        # All credentials at 90%+ usage
        async def mock_get_usage(cred_id):
            return {"total_tokens": 180_000}  # 90% of default limit

        mock_memory.get_credential_usage = AsyncMock(side_effect=mock_get_usage)

        selected = strategy.select_credential(
            pool=mock_credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        # Should still select the one with lowest usage ratio
        assert selected is not None
        assert selected.id in ["cred-001", "cred-002", "cred-003"]

    def test_select_custom_rate_limit(self, mock_rotation_config, mock_rotation_context, mock_memory):
        """Test selection with custom rate limit in metadata."""
        strategy = RateLimitAwareRotationStrategy()
        mock_rotation_context.memory = mock_memory
        mock_memory.is_enabled = True

        # Create credentials with custom rate limits
        credentials = [
            CredentialProfile(
                id="cred-001",
                name="Credential 1",
                type=CredentialType.API_KEY,
                credential_value="sk-test-001",
                status=CredentialStatus.ACTIVE,
                metadata={"tokens_per_minute": 100_000},  # Custom limit
            ),
            CredentialProfile(
                id="cred-002",
                name="Credential 2",
                type=CredentialType.API_KEY,
                credential_value="sk-test-002",
                status=CredentialStatus.ACTIVE,
                metadata={"tokens_per_minute": 300_000},  # Higher limit
            ),
        ]

        # Mock usage data
        async def mock_get_usage(cred_id):
            # Both at 50% of their respective limits
            usage_map = {
                "cred-001": {"total_tokens": 50_000},
                "cred-002": {"total_tokens": 150_000},
            }
            return usage_map.get(cred_id, {"total_tokens": 0})

        mock_memory.get_credential_usage = AsyncMock(side_effect=mock_get_usage)

        selected = strategy.select_credential(
            pool=credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        # Both at 50%, should select first found
        assert selected is not None

    def test_filters_inactive_credentials(self, mock_rotation_config, mock_rotation_context, mock_memory):
        """Test that inactive credentials are filtered."""
        strategy = RateLimitAwareRotationStrategy()
        mock_rotation_context.memory = mock_memory
        mock_memory.is_enabled = True

        credentials = [
            CredentialProfile(
                id="cred-001",
                name="Credential 1",
                type=CredentialType.API_KEY,
                credential_value="sk-test-001",
                status=CredentialStatus.ACTIVE,
            ),
            CredentialProfile(
                id="cred-002",
                name="Credential 2",
                type=CredentialType.API_KEY,
                credential_value="sk-test-002",
                status=CredentialStatus.RATE_LIMITED,
            ),
        ]

        selected = strategy.select_credential(
            pool=credentials,
            config=mock_rotation_config,
            context=mock_rotation_context,
        )

        # Should only select from active pool
        assert selected is not None
        assert selected.id == "cred-001"


# =============================================================================
# StrategyRegistry Tests
# =============================================================================


class TestStrategyRegistry:
    """Test suite for StrategyRegistry."""

    def test_init(self):
        """Test StrategyRegistry initialization."""
        registry = get_strategy_registry()
        assert isinstance(registry, get_strategy_registry().__class__)

    def test_get_manual_strategy(self):
        """Test getting ManualRotationStrategy."""
        registry = get_strategy_registry()
        strategy = registry.get_strategy(RotationMode.MANUAL)
        assert isinstance(strategy, ManualRotationStrategy)
        assert strategy.get_mode() == RotationMode.MANUAL

    def test_get_round_robin_strategy(self):
        """Test getting RoundRobinRotationStrategy."""
        registry = get_strategy_registry()
        strategy = registry.get_strategy(RotationMode.ROUND_ROBIN)
        assert isinstance(strategy, RoundRobinRotationStrategy)
        assert strategy.get_mode() == RotationMode.ROUND_ROBIN

    def test_get_usage_based_strategy(self):
        """Test getting UsageBasedRotationStrategy."""
        registry = get_strategy_registry()
        strategy = registry.get_strategy(RotationMode.USAGE_BASED)
        assert isinstance(strategy, UsageBasedRotationStrategy)
        assert strategy.get_mode() == RotationMode.USAGE_BASED

    def test_get_rate_limit_aware_strategy(self):
        """Test getting RateLimitAwareRotationStrategy."""
        registry = get_strategy_registry()
        strategy = registry.get_strategy(RotationMode.RATE_LIMIT_AWARE)
        assert isinstance(strategy, RateLimitAwareRotationStrategy)
        assert strategy.get_mode() == RotationMode.RATE_LIMIT_AWARE

    def test_strategy_caching(self):
        """Test that strategies are cached and reused."""
        registry = get_strategy_registry()

        # Clear cache first
        registry.clear()

        strategy1 = registry.get_strategy(RotationMode.ROUND_ROBIN)
        strategy2 = registry.get_strategy(RotationMode.ROUND_ROBIN)

        # Should be the same instance
        assert strategy1 is strategy2

    def test_list_strategies(self):
        """Test listing registered strategies."""
        registry = get_strategy_registry()
        registry.clear()

        # Register a strategy
        registry.register_strategy(ManualRotationStrategy())

        strategies = registry.list_strategies()
        assert RotationMode.MANUAL in strategies

    def test_clear(self):
        """Test clearing strategy cache."""
        registry = get_strategy_registry()

        # Get a strategy to cache it
        registry.get_strategy(RotationMode.MANUAL)

        # Clear cache
        registry.clear()

        # Cache should be empty
        assert len(registry._strategies) == 0


# =============================================================================
# RotationContext Tests
# =============================================================================


class TestRotationContext:
    """Test suite for RotationContext."""

    def test_init(self):
        """Test RotationContext initialization."""
        context = RotationContext(
            current_credential_id="test-cred",
            memory=None,
            task_id="test-task",
            request_count=5,
        )

        assert context.current_credential_id == "test-cred"
        assert context.memory is None
        assert context.task_id == "test-task"
        assert context.request_count == 5

    def test_repr(self):
        """Test string representation."""
        context = RotationContext(
            current_credential_id="cred-001",
            task_id="task-123",
            request_count=10,
        )

        repr_str = repr(context)
        assert "cred-001" in repr_str
        assert "task-123" in repr_str
        assert "10" in repr_str


# =============================================================================
# Run Tests
# =============================================================================


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
