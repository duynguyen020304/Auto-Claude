"""
Credential rotation strategies for Auto Claude.

Implements the Strategy pattern for credential rotation across multiple profiles.
Supports four rotation modes: manual, round_robin, usage_based, and rate_limit_aware.
"""

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from core.credentials import CredentialProfile, CredentialStatus, RotationMode

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from integrations.graphiti.queries_pkg.graphiti import GraphitiMemory


class RotationStrategy(ABC):
    """
    Abstract base class for credential rotation strategies.

    Defines the common interface that all rotation strategies must implement.
    Each strategy is responsible for selecting the appropriate credential from
    a pool based on its specific algorithm.

    Attributes:
        mode: The rotation mode this strategy implements

    Example:
        >>> strategy = ManualRotationStrategy()
        >>> credential = strategy.select_credential(
        ...     pool=[cred1, cred2, cred3],
        ...     config=rotation_config,
        ...     context=selection_context
        ... )
    """

    def __init__(self, mode: RotationMode) -> None:
        """
        Initialize the rotation strategy.

        Args:
            mode: The rotation mode this strategy implements
        """
        self.mode = mode
        logger.debug(f"Initialized {mode.value} rotation strategy")

    @abstractmethod
    def select_credential(
        self,
        pool: list[CredentialProfile],
        config: "RotationConfig",  # type: ignore[name-defined]
        context: "RotationContext",  # type: ignore[name-defined]
    ) -> CredentialProfile | None:
        """
        Select a credential from the pool based on the strategy's algorithm.

        This is the core method that each strategy must implement. It analyzes
        the available credentials and selects the most appropriate one based on
        the strategy's criteria (user preference, round-robin order, usage metrics,
        rate limit status, etc.).

        Args:
            pool: List of available credential profiles to select from
            config: Rotation configuration (mode, thresholds, etc.)
            context: Additional context for the selection (current credential,
                     memory system for usage queries, etc.)

        Returns:
            The selected CredentialProfile, or None if no suitable credential found

        Raises:
            ValueError: If pool is empty or configuration is invalid

        Note:
            Implementations should:
            - Filter out credentials that are not can_be_used() (disabled/rate_limited)
            - Return None if no active credentials available
            - Log selection decisions for debugging
        """
        pass

    def get_mode(self) -> RotationMode:
        """
        Get the rotation mode for this strategy.

        Returns:
            The RotationMode enum value for this strategy
        """
        return self.mode

    def filter_active_credentials(
        self, pool: list[CredentialProfile]
    ) -> list[CredentialProfile]:
        """
        Filter pool to only include active, available credentials.

        Removes credentials that are disabled or rate-limited, leaving only
        those that can_be_used() returns True for.

        Args:
            pool: List of credential profiles to filter

        Returns:
            List of active credential profiles (empty if none available)
        """
        active = [cred for cred in pool if cred.can_be_used()]

        if len(active) < len(pool):
            filtered_count = len(pool) - len(active)
            logger.debug(
                f"Filtered out {filtered_count} unavailable credential(s) "
                f"from pool of {len(pool)}"
            )

        return active

    def __repr__(self) -> str:
        """Return string representation."""
        return f"{self.__class__.__name__}(mode={self.mode.value})"


class RotationContext:
    """
    Context information for credential selection.

    Provides additional context that rotation strategies may need when
    selecting credentials, such as the currently active credential,
    memory system for usage queries, and request metadata.

    Attributes:
        current_credential_id: The credential ID currently in use (None for first selection)
        memory: GraphitiMemory instance for usage-based strategies (optional)
        task_id: Optional task/spec ID for tracking
        request_count: Number of requests made in current session
    """

    def __init__(
        self,
        current_credential_id: str | None = None,
        memory: "GraphitiMemory | None" = None,
        task_id: str | None = None,
        request_count: int = 0,
    ) -> None:
        """
        Initialize rotation context.

        Args:
            current_credential_id: ID of currently active credential (if any)
            memory: GraphitiMemory instance for usage tracking queries (optional)
            task_id: Optional task/spec identifier for logging
            request_count: Number of requests made in current session
        """
        self.current_credential_id = current_credential_id
        self.memory = memory
        self.task_id = task_id
        self.request_count = request_count

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"RotationContext("
            f"current={self.current_credential_id}, "
            f"task={self.task_id}, "
            f"requests={self.request_count})"
        )


class StrategyRegistry:
    """
    Registry for managing rotation strategy instances.

    Provides a centralized way to create and retrieve rotation strategy
    instances based on RotationMode enum values. Implements singleton
    pattern for strategy instances to avoid unnecessary object creation.

    Example:
        >>> registry = StrategyRegistry()
        >>> strategy = registry.get_strategy(RotationMode.ROUND_ROBIN)
        >>> credential = strategy.select_credential(pool, config, context)
    """

    def __init__(self) -> None:
        """Initialize the strategy registry with empty strategy cache."""
        self._strategies: dict[RotationMode, RotationStrategy] = {}
        logger.debug("Initialized StrategyRegistry")

    def register_strategy(self, strategy: RotationStrategy) -> None:
        """
        Register a rotation strategy instance.

        Args:
            strategy: The strategy instance to register

        Note:
            If a strategy for the same mode already exists, it will be
            replaced with the new instance.
        """
        self._strategies[strategy.mode] = strategy
        logger.debug(f"Registered strategy: {strategy.mode.value}")

    def get_strategy(self, mode: RotationMode) -> RotationStrategy:
        """
        Get a rotation strategy instance by mode.

        Creates and caches strategy instances on first access. Subsequent
        calls return the cached instance.

        Args:
            mode: The rotation mode to get a strategy for

        Returns:
            A RotationStrategy instance for the requested mode

        Raises:
            ValueError: If mode is not recognized or strategy creation fails

        Note:
            Strategies are lazily initialized - created only when first requested.
        """
        # Return cached strategy if available
        if mode in self._strategies:
            return self._strategies[mode]

        # Create and cache new strategy instance
        strategy = self._create_strategy(mode)
        self._strategies[mode] = strategy

        return strategy

    def _create_strategy(self, mode: RotationMode) -> RotationStrategy:
        """
        Create a new strategy instance for the given mode.

        Args:
            mode: The rotation mode to create a strategy for

        Returns:
            A new RotationStrategy instance

        Raises:
            ValueError: If mode is not recognized

        Note:
            This method imports strategy classes lazily to avoid circular
            dependencies between this module and strategy implementations.
        """
        # Import here to avoid circular dependency
        # Strategies are defined in this same file below
        if mode == RotationMode.MANUAL:
            from core.rotation import ManualRotationStrategy  # type: ignore[import-not-allowed]  # noqa: F401

            return ManualRotationStrategy()
        elif mode == RotationMode.ROUND_ROBIN:
            from core.rotation import (  # type: ignore[import-not-allowed]
                RoundRobinRotationStrategy,
            )

            return RoundRobinRotationStrategy()
        elif mode == RotationMode.USAGE_BASED:
            from core.rotation import (  # type: ignore[import-not-allowed]
                UsageBasedRotationStrategy,
            )

            return UsageBasedRotationStrategy()
        elif mode == RotationMode.RATE_LIMIT_AWARE:
            from core.rotation import (  # type: ignore[import-not-allowed]
                RateLimitAwareRotationStrategy,
            )

            return RateLimitAwareRotationStrategy()
        else:
            raise ValueError(f"Unknown rotation mode: {mode}")

    def list_strategies(self) -> list[RotationMode]:
        """
        List all registered strategy modes.

        Returns:
            List of RotationMode enum values that have been registered
        """
        return list(self._strategies.keys())

    def clear(self) -> None:
        """Clear all cached strategy instances."""
        self._strategies.clear()
        logger.debug("Cleared strategy registry cache")


# Global registry instance for convenient access
_global_registry: StrategyRegistry | None = None


def get_strategy_registry() -> StrategyRegistry:
    """
    Get the global strategy registry instance.

    Creates the registry on first call and returns the cached instance
    on subsequent calls.

    Returns:
        The global StrategyRegistry instance

    Example:
        >>> registry = get_strategy_registry()
        >>> strategy = registry.get_strategy(RotationMode.ROUND_ROBIN)
    """
    global _global_registry

    if _global_registry is None:
        _global_registry = StrategyRegistry()

    return _global_registry
