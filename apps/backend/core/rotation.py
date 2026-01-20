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


class ManualRotationStrategy(RotationStrategy):
    """
    Manual rotation strategy where user explicitly selects the credential.

    In manual mode, the credential is selected based on user configuration
    via environment variables or spec settings. This provides direct control
    over which credential is used, with no automatic rotation.

    The strategy looks for the credential ID in:
    1. RotationConfig.manual_credential_id (explicit configuration)
    2. Environment variable AUTO_CLAUDE_CREDENTIAL_ID
    3. First available credential in pool if no specific selection

    Example:
        >>> strategy = ManualRotationStrategy()
        >>> # Configure manual credential via environment
        >>> os.environ['AUTO_CLAUDE_CREDENTIAL_ID'] = 'cred-001'
        >>> credential = strategy.select_credential(pool, config, context)
    """

    def __init__(self) -> None:
        """Initialize manual rotation strategy."""
        super().__init__(mode=RotationMode.MANUAL)
        self._selected_credential_id: str | None = None
        logger.debug("Initialized ManualRotationStrategy")

    def select_credential(
        self,
        pool: list[CredentialProfile],
        config: "RotationConfig",  # type: ignore[name-defined]
        context: "RotationContext",  # type: ignore[name-defined]
    ) -> CredentialProfile | None:
        """
        Select a credential based on user's explicit selection.

        The selection priority is:
        1. Check if config.manual_credential_id is set and valid
        2. Check environment variable AUTO_CLAUDE_CREDENTIAL_ID
        3. Fall back to first active credential in pool (backward compatibility)

        Args:
            pool: List of available credential profiles
            config: Rotation configuration (may contain manual_credential_id)
            context: Selection context (not used in manual mode)

        Returns:
            The selected CredentialProfile, or None if no suitable credential found

        Raises:
            ValueError: If pool is empty
        """
        import os

        if not pool:
            raise ValueError("Credential pool is empty")

        # Filter to only active credentials
        active_pool = self.filter_active_credentials(pool)

        if not active_pool:
            logger.warning(
                "Manual rotation: No active credentials available in pool"
            )
            return None

        # Priority 1: Check config for explicit credential ID
        if hasattr(config, "manual_credential_id") and config.manual_credential_id:
            credential_id = config.manual_credential_id
            logger.debug(f"Manual selection from config: {credential_id}")
            credential = self._find_credential_by_id(active_pool, credential_id)
            if credential:
                return credential
            else:
                logger.warning(
                    f"Configured credential {credential_id} not found or inactive"
                )

        # Priority 2: Check environment variable
        env_credential_id = os.environ.get("AUTO_CLAUDE_CREDENTIAL_ID")
        if env_credential_id:
            logger.debug(f"Manual selection from environment: {env_credential_id}")
            credential = self._find_credential_by_id(
                active_pool, env_credential_id
            )
            if credential:
                return credential
            else:
                logger.warning(
                    f"Environment credential {env_credential_id} not found or inactive"
                )

        # Priority 3: Fall back to first active credential (backward compatibility)
        # This ensures single-credential setups continue to work
        selected = active_pool[0]
        logger.debug(
            f"Manual selection: Using first active credential {selected.id}"
        )
        return selected

    def _find_credential_by_id(
        self, pool: list[CredentialProfile], credential_id: str
    ) -> CredentialProfile | None:
        """
        Find a credential in the pool by ID.

        Args:
            pool: List of credential profiles to search
            credential_id: ID of credential to find

        Returns:
            CredentialProfile if found, None otherwise
        """
        for credential in pool:
            if credential.id == credential_id:
                logger.info(
                    f"Manual rotation: Selected credential {credential_id} "
                    f"({credential.name})"
                )
                return credential

        return None

    def set_credential(self, credential_id: str) -> None:
        """
        Programmatically set the credential ID for manual selection.

        This allows programmatic override of the manual selection without
        using environment variables or config.

        Args:
            credential_id: ID of credential to use

        Example:
            >>> strategy = ManualRotationStrategy()
            >>> strategy.set_credential('cred-001')
            >>> credential = strategy.select_credential(pool, config, context)
        """
        self._selected_credential_id = credential_id
        logger.debug(f"Manual credential set to: {credential_id}")

    def get_selected_credential(self) -> str | None:
        """
        Get the currently selected credential ID.

        Returns:
            The credential ID if set, None otherwise
        """
        return self._selected_credential_id


class RoundRobinRotationStrategy(RotationStrategy):
    """
    Round-robin rotation strategy for sequential credential cycling.

    In round-robin mode, credentials are selected sequentially from the pool,
    cycling back to the beginning after reaching the end. This provides
    simple load distribution across multiple credentials.

    The strategy maintains an index that advances after each selection:
    - index = (current_index + 1) % len(available_credentials)
    - Skips credentials that are not can_be_used() (disabled/rate_limited)
    - Handles empty pools and single-credential setups gracefully

    Example:
        >>> strategy = RoundRobinRotationStrategy()
        >>> # First call selects cred1, second selects cred2, etc.
        >>> credential1 = strategy.select_credential(pool, config, context)
        >>> credential2 = strategy.select_credential(pool, config, context)
        >>> credential3 = strategy.select_credential(pool, config, context)
        >>> # Fourth call cycles back to cred1
    """

    def __init__(self) -> None:
        """Initialize round-robin rotation strategy."""
        super().__init__(mode=RotationMode.ROUND_ROBIN)
        self._current_index: int = 0
        logger.debug("Initialized RoundRobinRotationStrategy")

    def select_credential(
        self,
        pool: list[CredentialProfile],
        config: "RotationConfig",  # type: ignore[name-defined]
        context: "RotationContext",  # type: ignore[name-defined]
    ) -> CredentialProfile | None:
        """
        Select a credential using round-robin sequential selection.

        The selection process:
        1. Filter pool to only active credentials (can_be_used())
        2. Return None if no active credentials available
        3. Select credential at current_index
        4. Advance index: (current_index + 1) % len(active_credentials)
        5. Log selection for debugging

        Args:
            pool: List of available credential profiles
            config: Rotation configuration (not used in round-robin)
            context: Selection context (not used in round-robin)

        Returns:
            The selected CredentialProfile, or None if no suitable credential found

        Raises:
            ValueError: If pool is empty

        Note:
            The index is maintained across calls and wraps around using modulo
            arithmetic. If all credentials become rate_limited during rotation,
            the strategy will return None on the next call.
        """
        if not pool:
            raise ValueError("Credential pool is empty")

        # Filter to only active credentials
        active_pool = self.filter_active_credentials(pool)

        if not active_pool:
            logger.warning(
                "Round-robin rotation: No active credentials available in pool"
            )
            return None

        # Select credential at current index
        selected = active_pool[self._current_index]
        logger.info(
            f"Round-robin rotation: Selected credential {selected.id} "
            f"({selected.name}) at index {self._current_index} "
            f"of {len(active_pool)} active credentials"
        )

        # Advance index for next selection (with wraparound)
        self._current_index = (self._current_index + 1) % len(active_pool)
        logger.debug(
            f"Round-robin index advanced to {self._current_index} "
            f"(wraps at {len(active_pool)})"
        )

        return selected

    def reset_index(self) -> None:
        """
        Reset the round-robin index to the beginning.

        This allows the rotation cycle to restart from the first credential.
        Useful for testing or when you want to restart the rotation sequence.

        Example:
            >>> strategy = RoundRobinRotationStrategy()
            >>> # After several selections...
            >>> strategy.reset_index()  # Start over from first credential
        """
        self._current_index = 0
        logger.debug("Round-robin index reset to 0")

    def get_current_index(self) -> int:
        """
        Get the current round-robin index.

        Returns:
            The current index position (0-based)

        Note:
            This is the index that will be used for the NEXT selection,
            not the index of the previously selected credential.
        """
        return self._current_index

    def set_index(self, index: int) -> None:
        """
        Set the round-robin index to a specific position.

        This allows manual control over the rotation sequence, useful for
        testing or recovery scenarios.

        Args:
            index: The index position to set (0-based)

        Raises:
            ValueError: If index is negative

        Example:
            >>> strategy = RoundRobinRotationStrategy()
            >>> strategy.set_index(2)  # Next selection will use credential at index 2
        """
        if index < 0:
            raise ValueError(f"Index must be non-negative, got {index}")

        self._current_index = index
        logger.debug(f"Round-robin index set to {index}")
