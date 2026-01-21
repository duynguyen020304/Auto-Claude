"""
Credential rotation strategies for Auto Claude.

Implements the Strategy pattern for credential rotation across multiple profiles.
Supports four rotation modes: manual, round_robin, usage_based, and rate_limit_aware.
"""

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

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


class UsageBasedRotationStrategy(RotationStrategy):
    """
    Usage-based rotation strategy for intelligent credential selection.

    In usage-based mode, the strategy selects the credential with the lowest
    usage metrics (total tokens consumed) from the pool. This provides smart
    load distribution that considers actual consumption rather than just
    request count.

    The strategy queries Graphiti memory system for usage metrics:
    - Retrieves token usage for each credential in the pool
    - Selects the credential with the lowest total token consumption
    - Falls back to first active credential if Graphiti is unavailable
    - Handles missing usage data gracefully

    Example:
        >>> strategy = UsageBasedRotationStrategy()
        >>> # Selects least-used credential from pool
        >>> credential = strategy.select_credential(
        ...     pool=[cred1, cred2, cred3],
        ...     config=rotation_config,
        ...     context=selection_context  # Must include memory for usage queries
        ... )
    """

    def __init__(self) -> None:
        """Initialize usage-based rotation strategy."""
        super().__init__(mode=RotationMode.USAGE_BASED)
        logger.debug("Initialized UsageBasedRotationStrategy")

    def select_credential(
        self,
        pool: list[CredentialProfile],
        config: "RotationConfig",  # type: ignore[name-defined]
        context: "RotationContext",  # type: ignore[name-defined]
    ) -> CredentialProfile | None:
        """
        Select a credential based on lowest usage metrics from Graphiti.

        The selection process:
        1. Filter pool to only active credentials (can_be_used())
        2. Return None if no active credentials available
        3. If Graphiti memory available, query for least-used credential
        4. If Graphiti unavailable or no usage data, fall back to first active
        5. Log selection for debugging

        Args:
            pool: List of available credential profiles
            config: Rotation configuration (not used in usage-based)
            context: Selection context (memory is used for usage queries)

        Returns:
            The selected CredentialProfile, or None if no suitable credential found

        Raises:
            ValueError: If pool is empty

        Note:
            Requires context.memory to be set for usage-based selection.
            Falls back to first active credential if memory is unavailable.
        """
        if not pool:
            raise ValueError("Credential pool is empty")

        # Filter to only active credentials
        active_pool = self.filter_active_credentials(pool)

        if not active_pool:
            logger.warning(
                "Usage-based rotation: No active credentials available in pool"
            )
            return None

        # Try to use Graphiti memory for intelligent selection
        if context.memory and context.memory.is_enabled:
            try:
                # Get credential IDs from active pool
                credential_ids = [cred.id for cred in active_pool]

                # Query Graphiti for least-used credential
                import asyncio

                least_used_id = asyncio.run(
                    context.memory.get_least_used_credential(credential_ids)
                )

                if least_used_id:
                    # Find the credential with the least-used ID
                    for credential in active_pool:
                        if credential.id == least_used_id:
                            logger.info(
                                f"Usage-based rotation: Selected credential {credential.id} "
                                f"({credential.name}) based on lowest token usage "
                                f"from {len(active_pool)} active credentials"
                            )
                            return credential
                else:
                    logger.debug(
                        "Usage-based rotation: No usage data available in Graphiti, "
                        "falling back to first active credential"
                    )
            except Exception as e:
                logger.warning(
                    f"Usage-based rotation: Failed to query Graphiti for usage: {e}, "
                    "falling back to first active credential"
                )

        # Fallback: Use first active credential
        selected = active_pool[0]
        logger.info(
            f"Usage-based rotation: Selected credential {selected.id} "
            f"({selected.name}) as fallback (no usage data available)"
        )

        return selected


class RateLimitAwareRotationStrategy(RotationStrategy):
    """
    Rate-limit-aware rotation strategy for proactive credential rotation.

    In rate-limit-aware mode, the strategy monitors usage patterns and predicts
    when credentials are approaching their rate limits, rotating BEFORE hitting
    limits to prevent 429 errors. This provides proactive load distribution that
    considers both historical usage and rate limit thresholds.

    The strategy queries Graphiti memory system for usage metrics:
    - Retrieves token usage for each credential in the pool
    - Calculates usage ratio (current_usage / limit) for each credential
    - Selects the credential with the lowest usage ratio below threshold
    - Falls back to first active credential if Graphiti is unavailable
    - Handles missing rate limit info gracefully

    Example:
        >>> strategy = RateLimitAwareRotationStrategy()
        >>> # Selects credential farthest from rate limit
        >>> credential = strategy.select_credential(
        ...     pool=[cred1, cred2, cred3],
        ...     config=rotation_config,  # threshold=0.8 (80%)
        ...     context=selection_context  # Must include memory for usage queries
        ... )
    """

    def __init__(self) -> None:
        """Initialize rate-limit-aware rotation strategy."""
        super().__init__(mode=RotationMode.RATE_LIMIT_AWARE)
        logger.debug("Initialized RateLimitAwareRotationStrategy")

    def select_credential(
        self,
        pool: list[CredentialProfile],
        config: "RotationConfig",  # type: ignore[name-defined]
        context: "RotationContext",  # type: ignore[name-defined]
    ) -> CredentialProfile | None:
        """
        Select a credential based on lowest usage ratio to avoid rate limits.

        The selection process:
        1. Filter pool to only active credentials (can_be_used())
        2. Return None if no active credentials available
        3. If Graphiti memory available, query for usage of all credentials
        4. Calculate usage ratio for each credential (usage / limit)
        5. Select credential with lowest usage ratio below threshold
        6. If all credentials at/above threshold, select lowest usage anyway
        7. If Graphiti unavailable or no usage data, fall back to first active
        8. Log selection for debugging

        Args:
            pool: List of available credential profiles
            config: Rotation configuration (rate_limit_threshold is used)
            context: Selection context (memory is used for usage queries)

        Returns:
            The selected CredentialProfile, or None if no suitable credential found

        Raises:
            ValueError: If pool is empty

        Note:
            Requires context.memory to be set for rate-limit-aware selection.
            Falls back to first active credential if memory is unavailable.
            The threshold from config.rate_limit_threshold determines when to
            rotate (default 0.8 = 80% of limit).
        """
        if not pool:
            raise ValueError("Credential pool is empty")

        # Filter to only active credentials
        active_pool = self.filter_active_credentials(pool)

        if not active_pool:
            logger.warning(
                "Rate-limit-aware rotation: No active credentials available in pool"
            )
            return None

        # Try to use Graphiti memory for intelligent selection
        if context.memory and context.memory.is_enabled:
            try:
                # Query Graphiti for usage of all credentials
                import asyncio

                usage_map = self._get_usage_map(context, active_pool)

                if usage_map:
                    # Find credential with lowest usage ratio
                    selected_credential = self._select_by_usage_ratio(
                        active_pool, usage_map, config
                    )
                    if selected_credential:
                        return selected_credential
                else:
                    logger.debug(
                        "Rate-limit-aware rotation: No usage data available in Graphiti, "
                        "falling back to first active credential"
                    )
            except Exception as e:
                logger.warning(
                    f"Rate-limit-aware rotation: Failed to query Graphiti for usage: {e}, "
                    "falling back to first active credential"
                )

        # Fallback: Use first active credential
        selected = active_pool[0]
        logger.info(
            f"Rate-limit-aware rotation: Selected credential {selected.id} "
            f"({selected.name}) as fallback (no usage data available)"
        )

        return selected

    def _get_usage_map(
        self, context: "RotationContext", active_pool: list[CredentialProfile]  # type: ignore[name-defined]
    ) -> dict[str, int] | None:
        """
        Query Graphiti for usage metrics of all credentials in the pool.

        Args:
            context: Rotation context with memory system
            active_pool: List of active credential profiles

        Returns:
            Dictionary mapping credential IDs to total token usage, or None if queries fail
        """
        import asyncio

        usage_map: dict[str, int] = {}

        async def query_credential_usage() -> None:
            """Query usage for all credentials asynchronously."""
            if not context.memory:
                return

            for credential in active_pool:
                try:
                    usage_data = await context.memory.get_credential_usage(credential.id)
                    if usage_data and "total_tokens" in usage_data:
                        usage_map[credential.id] = usage_data["total_tokens"]
                except Exception as e:
                    logger.debug(
                        f"Failed to get usage for credential {credential.id}: {e}"
                    )
                    # Continue with other credentials

        try:
            asyncio.run(query_credential_usage())
        except Exception as e:
            logger.warning(f"Failed to query credential usage: {e}")
            return None

        return usage_map if usage_map else None

    def _select_by_usage_ratio(
        self,
        active_pool: list[CredentialProfile],
        usage_map: dict[str, int],
        config: "RotationConfig",  # type: ignore[name-defined]
    ) -> CredentialProfile | None:
        """
        Select credential with lowest usage ratio below threshold.

        Args:
            active_pool: List of active credential profiles
            usage_map: Dictionary mapping credential IDs to total token usage
            config: Rotation configuration with rate_limit_threshold

        Returns:
            CredentialProfile with lowest usage ratio, or None if selection fails
        """
        # Default rate limit (can be overridden per credential)
        # Anthropic's default TPM limit is typically 200,000 tokens/minute
        DEFAULT_TOKEN_LIMIT = 200_000

        best_credential = None
        best_usage_ratio = float("inf")

        for credential in active_pool:
            # Get usage for this credential
            usage = usage_map.get(credential.id, 0)

            # Get rate limit for this credential (from metadata or default)
            limit = self._get_credential_limit(credential, DEFAULT_TOKEN_LIMIT)

            # Calculate usage ratio
            if limit > 0:
                usage_ratio = usage / limit
            else:
                usage_ratio = 0.0
                logger.debug(
                    f"Credential {credential.id} has limit of 0, setting usage_ratio to 0"
                )

            # Check if this credential is better than current best
            if usage_ratio < best_usage_ratio:
                best_usage_ratio = usage_ratio
                best_credential = credential

                # If we found a credential well below threshold, use it
                if usage_ratio < config.rate_limit_threshold * 0.8:
                    logger.debug(
                        f"Found credential {credential.id} with usage ratio "
                        f"{usage_ratio:.2%} (well below threshold {config.rate_limit_threshold:.2%})"
                    )
                    break

        if best_credential:
            threshold_status = (
                "ABOVE" if best_usage_ratio >= config.rate_limit_threshold else "below"
            )
            logger.info(
                f"Rate-limit-aware rotation: Selected credential {best_credential.id} "
                f"({best_credential.name}) with usage ratio {best_usage_ratio:.2%} "
                f"({threshold_status} threshold {config.rate_limit_threshold:.2%}) "
                f"from {len(active_pool)} active credentials"
            )

            # Warn if all credentials are near/at threshold
            if best_usage_ratio >= config.rate_limit_threshold:
                logger.warning(
                    f"All credentials may be near rate limits! "
                    f"Best usage ratio: {best_usage_ratio:.2%}"
                )

        return best_credential

    def _get_credential_limit(
        self, credential: CredentialProfile, default_limit: int
    ) -> int:
        """
        Get the rate limit for a credential.

        Checks the credential's rate_limit_info and metadata for limit information,
        falling back to the default limit if not found.

        Args:
            credential: CredentialProfile to get limit for
            default_limit: Default limit to use if not found in credential

        Returns:
            Rate limit in tokens per minute
        """
        # Check rate_limit_info first
        if credential.rate_limit_info:
            if credential.rate_limit_info.tokens_per_minute:
                return credential.rate_limit_info.tokens_per_minute

        # Check metadata for custom limit
        if credential.metadata:
            custom_limit = credential.metadata.get("tokens_per_minute")
            if custom_limit:
                try:
                    return int(custom_limit)
                except (ValueError, TypeError):
                    logger.debug(
                        f"Invalid tokens_per_minute in metadata for {credential.id}"
                    )

        # Return default limit
        return default_limit


class RotationManager:
    """
    Manager class for coordinating credential rotation strategies and selection.

    The RotationManager provides a high-level interface for credential rotation,
    coordinating between rotation configuration, strategy selection, and credential
    storage. It handles the complete rotation workflow including credential selection,
    validation, error handling, and fallback logic.

    This class serves as the main entry point for SDK client code to perform
    credential rotation, abstracting away the complexity of strategy selection
    and credential management.

    Attributes:
        config: Rotation configuration (mode, pool, thresholds, etc.)
        registry: Strategy registry for creating/getting strategy instances
        current_credential_id: The ID of the currently active credential

    Example:
        >>> manager = RotationManager(
        ...     config=RotationConfig(mode=RotationMode.ROUND_ROBIN, pool=["cred1", "cred2"]),
        ...     memory=graphiti_memory
        ... )
        >>> # Select credential for API request
        >>> credential = manager.select_credential()
        >>> # Record usage after request completes
        >>> manager.record_usage(credential.id, tokens=1000)
        >>> # Handle rate limit error
        >>> manager.handle_rate_limit(current_credential_id)
    """

    def __init__(
        self,
        config: "RotationConfig",  # type: ignore[name-defined]
        memory: "GraphitiMemory | None" = None,
        task_id: str | None = None,
    ) -> None:
        """
        Initialize the rotation manager.

        Args:
            config: Rotation configuration (mode, credential pool, thresholds)
            memory: Optional GraphitiMemory instance for usage-based strategies
            task_id: Optional task/spec identifier for logging and tracking

        Raises:
            ValueError: If configuration is invalid
        """
        # Import RotationConfig locally to avoid circular dependency
        from core.credentials import RotationConfig

        if not isinstance(config, RotationConfig):
            raise ValueError(
                f"config must be a RotationConfig instance, got {type(config)}"
            )

        self.config = config
        self.memory = memory
        self.task_id = task_id
        self.current_credential_id: str | None = None
        self.request_count = 0

        # Get strategy registry and initial strategy
        self._registry = get_strategy_registry()
        self._strategy: RotationStrategy | None = None

        logger.info(
            f"Initialized RotationManager: mode={config.mode.value}, "
            f"pool_size={len(config.credential_pool)}, "
            f"task={task_id or 'N/A'}"
        )

    def select_credential(self) -> "CredentialProfile | None":  # type: ignore[name-defined]
        """
        Select a credential using the configured rotation strategy.

        This is the main method called by SDK client code to get the appropriate
        credential for an API request. It coordinates with the strategy registry
        to get the appropriate strategy instance and delegates credential selection
        to that strategy.

        The method handles:
        - Loading credentials from storage based on the configured pool
        - Filtering to only active credentials
        - Delegating selection to the appropriate strategy
        - Updating the current credential tracking
        - Error handling and logging

        Returns:
            The selected CredentialProfile, or None if no suitable credential found

        Raises:
            ValueError: If credential pool is empty or configuration is invalid

        Note:
            The selected credential is automatically tracked as current_credential_id
            for use in subsequent operations like handle_rate_limit().

        Example:
            >>> manager = RotationManager(config, memory)
            >>> credential = manager.select_credential()
            >>> if credential:
            ...     # Use credential for API request
            ...     api_call(credential.credential_value)
        """
        from core.auth import get_credential, list_credentials

        # Load credentials from the configured pool
        pool = self._load_credential_pool()

        if not pool:
            logger.error(
                f"RotationManager: No credentials available in pool "
                f"(pool IDs: {self.config.credential_pool})"
            )
            return None

        # Get or create strategy instance
        strategy = self._get_strategy()

        # Create rotation context
        context = RotationContext(
            current_credential_id=self.current_credential_id,
            memory=self.memory,
            task_id=self.task_id,
            request_count=self.request_count,
        )

        # Delegate selection to strategy
        try:
            selected = strategy.select_credential(pool, self.config, context)

            if selected:
                # Update tracking
                self.current_credential_id = selected.id
                self.request_count += 1

                logger.debug(
                    f"RotationManager: Selected credential {selected.id} "
                    f"({selected.name}) for request #{self.request_count}"
                )
            else:
                logger.warning(
                    f"RotationManager: Strategy returned None for credential selection"
                )

            return selected

        except Exception as e:
            logger.error(
                f"RotationManager: Failed to select credential: {e}",
                exc_info=True,
            )
            return None

    def _load_credential_pool(self) -> list["CredentialProfile"]:  # type: ignore[name-defined]
        """
        Load credential profiles from storage based on the configured pool.

        Loads credentials by ID from the configured credential pool. Handles
        missing credentials, disabled credentials, and storage errors gracefully.

        Returns:
            List of CredentialProfile objects from the pool (empty if none found)

        Note:
            Credentials that fail to load from storage are logged but not included
            in the returned pool. The strategy will handle empty pools.
        """
        from core.auth import get_credential
        from core.credentials import CredentialProfile

        pool: list[CredentialProfile] = []
        pool_ids = self.config.get_effective_pool()

        if not pool_ids:
            logger.debug("RotationManager: Credential pool is empty")
            return []

        for cred_id in pool_ids:
            try:
                credential = get_credential(cred_id)
                if credential:
                    pool.append(credential)
                    logger.debug(
                        f"RotationManager: Loaded credential {cred_id} "
                        f"({credential.name}, status={credential.status.value})"
                    )
                else:
                    logger.warning(
                        f"RotationManager: Credential {cred_id} not found in storage"
                    )
            except Exception as e:
                logger.warning(
                    f"RotationManager: Failed to load credential {cred_id}: {e}"
                )

        logger.info(
            f"RotationManager: Loaded {len(pool)} credentials from pool "
            f"(requested {len(pool_ids)})"
        )

        return pool

    def _get_strategy(self) -> RotationStrategy:
        """
        Get or create the rotation strategy instance.

        Uses the strategy registry to get the appropriate strategy for the
        configured rotation mode. Strategy instances are cached by the registry
        for efficiency.

        Returns:
            A RotationStrategy instance for the configured mode

        Raises:
            ValueError: If the rotation mode is not recognized
        """
        if self._strategy is None:
            self._strategy = self._registry.get_strategy(self.config.mode)
            logger.debug(
                f"RotationManager: Using strategy {self._strategy.__class__.__name__}"
            )

        return self._strategy

    def record_usage(
        self,
        credential_id: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_read_tokens: int = 0,
        cache_creation_tokens: int = 0,
    ) -> None:
        """
        Record API usage for a credential.

        This method should be called after each API request completes to update
        usage metrics in both the credential profile and Graphiti memory system.
        This enables usage-based and rate-limit-aware rotation strategies to make
        informed decisions.

        Args:
            credential_id: ID of the credential that was used
            input_tokens: Number of input tokens consumed
            output_tokens: Number of output tokens consumed
            cache_read_tokens: Number of cache read tokens
            cache_creation_tokens: Number of cache creation tokens

        Note:
            Usage is recorded to both the credential profile (for immediate access)
            and Graphiti memory (for persistent tracking across sessions).

        Example:
            >>> manager = RotationManager(config, memory)
            >>> credential = manager.select_credential()
            >>> # Make API request...
            >>> manager.record_usage(
            ...     credential.id,
            ...     input_tokens=1000,
            ...     output_tokens=500
            ... )
        """
        from core.auth import get_credential

        total_tokens = input_tokens + output_tokens + cache_read_tokens

        try:
            # Update credential profile usage metrics
            credential = get_credential(credential_id)
            if credential:
                credential.record_usage(
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cache_read_tokens=cache_read_tokens,
                    cache_creation_tokens=cache_creation_tokens,
                )
                logger.debug(
                    f"RotationManager: Recorded {total_tokens} tokens for credential "
                    f"{credential_id} (total: {credential.usage_metrics.total_tokens})"
                )

            # Record to Graphiti memory if available
            if self.memory and self.memory.is_enabled:
                import asyncio

                try:
                    asyncio.run(
                        self.memory.record_usage(credential_id, total_tokens)
                    )
                    logger.debug(
                        f"RotationManager: Recorded usage to Graphiti for {credential_id}"
                    )
                except Exception as e:
                    logger.warning(
                        f"RotationManager: Failed to record usage to Graphiti: {e}"
                    )

        except Exception as e:
            logger.error(
                f"RotationManager: Failed to record usage for {credential_id}: {e}",
                exc_info=True,
            )

    def handle_rate_limit(self, credential_id: str) -> str | None:
        """
        Handle a rate limit error for a credential.

        When a 429 rate limit error occurs, this method:
        1. Marks the credential as rate_limited
        2. Logs the rate limit event
        3. Returns the ID of the next available credential (if any)

        This allows the SDK client code to automatically retry with a different
        credential without manual intervention.

        Args:
            credential_id: ID of the credential that hit the rate limit

        Returns:
            ID of the next available credential to retry with, or None if no
            alternative credential is available

        Example:
            >>> try:
            ...     response = api_request(credential.credential_value)
            ... except RateLimitError:
            ...     next_credential_id = manager.handle_rate_limit(credential.id)
            ...     if next_credential_id:
            ...         # Retry with new credential
            ...         credential = get_credential(next_credential_id)
            ...         response = api_request(credential.credential_value)
        """
        from core.auth import get_credential, save_credential

        try:
            # Mark credential as rate_limited
            credential = get_credential(credential_id)
            if credential:
                credential.mark_rate_limited()
                save_credential(credential)

                logger.warning(
                    f"RotationManager: Credential {credential_id} ({credential.name}) "
                    f"marked as rate_limited"
                )

                # Try to select next available credential
                next_credential = self.select_credential()

                if next_credential:
                    logger.info(
                        f"RotationManager: Switching to credential {next_credential.id} "
                        f"({next_credential.name}) after rate limit"
                    )
                    return next_credential.id
                else:
                    logger.error(
                        f"RotationManager: No alternative credentials available "
                        f"after rate limit on {credential_id}"
                    )
                    return None
            else:
                logger.warning(
                    f"RotationManager: Credential {credential_id} not found, "
                    f"cannot mark as rate_limited"
                )
                return None

        except Exception as e:
            logger.error(
                f"RotationManager: Failed to handle rate limit for {credential_id}: {e}",
                exc_info=True,
            )
            return None

    def should_rotate_proactively(
        self, credential_id: str | None = None
    ) -> bool:
        """
        Check if proactive rotation is recommended based on current usage.

        This method is used by rate-limit-aware mode to determine if a credential
        is approaching its rate limit and should be rotated before hitting the limit.

        Args:
            credential_id: Optional credential ID to check (uses current if None)

        Returns:
            True if rotation is recommended, False otherwise

        Note:
            This is a proactive check - actual rotation is performed by calling
            select_credential() which will use the strategy to select the best
            credential based on current conditions.
        """
        from core.auth import get_credential

        cred_id = credential_id or self.current_credential_id

        if not cred_id:
            return False

        try:
            # Only applicable for rate_limit_aware mode
            if self.config.mode != RotationMode.RATE_LIMIT_AWARE:
                return False

            # Get credential usage
            credential = get_credential(cred_id)
            if not credential or not self.memory:
                return False

            # Query Graphiti for usage
            import asyncio

            usage_data = asyncio.run(self.memory.get_credential_usage(cred_id))
            if not usage_data:
                return False

            # Get rate limit for credential
            limit = self._get_credential_limit(credential)
            current_usage = usage_data.get("total_tokens", 0)

            # Check if threshold exceeded
            should_rotate = self.config.should_rotate_proactively(
                current_usage, limit
            )

            if should_rotate:
                logger.info(
                    f"RotationManager: Credential {cred_id} at {current_usage}/{limit} "
                    f"tokens ({current_usage/limit:.1%}), proactive rotation recommended"
                )

            return should_rotate

        except Exception as e:
            logger.warning(
                f"RotationManager: Failed to check proactive rotation for {cred_id}: {e}"
            )
            return False

    def _get_credential_limit(
        self, credential: "CredentialProfile",  # type: ignore[name-defined]
    ) -> int:
        """
        Get the rate limit for a credential.

        Checks the credential's rate_limit_info and metadata for limit information,
        falling back to the default limit if not found.

        Args:
            credential: CredentialProfile to get limit for

        Returns:
            Rate limit in tokens per minute
        """
        # Check rate_limit_info first
        if credential.rate_limit_info:
            if credential.rate_limit_info.tokens_per_minute:
                return credential.rate_limit_info.tokens_per_minute

        # Check metadata for custom limit
        if credential.metadata:
            custom_limit = credential.metadata.get("tokens_per_minute")
            if custom_limit:
                try:
                    return int(custom_limit)
                except (ValueError, TypeError):
                    logger.debug(
                        f"Invalid tokens_per_minute in metadata for {credential.id}"
                    )

        # Return default limit (Anthropic's typical TPM limit)
        return 200_000

    def get_status(self) -> dict[str, Any]:
        """
        Get the current status of the rotation manager.

        Returns a dictionary with information about the current rotation state,
        including active credential, pool status, and request statistics.

        Returns:
            Dictionary containing rotation manager status

        Example:
            >>> manager = RotationManager(config, memory)
            >>> status = manager.get_status()
            >>> print(f"Current credential: {status['current_credential_id']}")
            >>> print(f"Requests made: {status['request_count']}")
        """
        status: dict[str, Any] = {
            "mode": self.config.mode.value,
            "pool_size": len(self.config.credential_pool),
            "pool_ids": self.config.credential_pool.copy(),
            "current_credential_id": self.current_credential_id,
            "request_count": self.request_count,
            "task_id": self.task_id,
            "strategy": self._strategy.__class__.__name__
            if self._strategy
            else None,
        }

        return status

    def reset(self) -> None:
        """
        Reset the rotation manager state.

        Clears tracking state (current credential, request count) without
        changing the configuration. Useful for testing or when restarting
        a session.

        Example:
            >>> manager = RotationManager(config, memory)
            >>> # After many requests...
            >>> manager.reset()  # Start fresh with same config
        """
        self.current_credential_id = None
        self.request_count = 0

        # Reset round-robin index if applicable
        if self.config.mode == RotationMode.ROUND_ROBIN and self._strategy:
            if isinstance(self._strategy, RoundRobinRotationStrategy):
                self._strategy.reset_index()

        logger.info("RotationManager: State reset")

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"RotationManager(mode={self.config.mode.value}, "
            f"pool_size={len(self.config.credential_pool)}, "
            f"current={self.current_credential_id}, "
            f"requests={self.request_count})"
        )
