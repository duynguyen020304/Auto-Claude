"""
Token usage tracking and aggregation for credential management.

Provides the UsageTracker class for capturing token counts from SDK responses,
aggregating per-credential metrics, and storing usage data in Graphiti memory.
This is a critical component for usage-based rotation strategies.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.credentials import CredentialProfile

logger = logging.getLogger(__name__)


@dataclass
class TokenUsage:
    """
    Token usage data from a single SDK response.

    Attributes:
        input_tokens: Number of input tokens consumed
        output_tokens: Number of output tokens consumed
        cache_creation_input_tokens: Number of cache creation tokens
        cache_read_tokens: Number of cache read tokens
        total_tokens: Total tokens consumed (input + output + cache_read)
    """

    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_tokens: int = 0

    def __post_init__(self):
        """Calculate total tokens after initialization."""
        # We'll compute this on-demand in the property
        pass

    @property
    def total_tokens(self) -> int:
        """Calculate total tokens consumed."""
        return self.input_tokens + self.output_tokens + self.cache_read_tokens

    def to_dict(self) -> dict[str, int]:
        """Convert to dictionary representation."""
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_creation_input_tokens": self.cache_creation_input_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "total_tokens": self.total_tokens,
        }


@dataclass
class UsageSnapshot:
    """
    Aggregated usage metrics for a credential.

    Attributes:
        credential_id: ID of the credential
        total_requests: Total number of API requests
        total_tokens: Total tokens consumed across all requests
        input_tokens: Total input tokens
        output_tokens: Total output tokens
        cache_read_tokens: Total cache read tokens
        cache_creation_tokens: Total cache creation tokens
        last_used: Timestamp of last usage
        average_tokens_per_request: Average tokens consumed per request
    """

    credential_id: str
    total_requests: int = 0
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    last_used: datetime | None = None

    @property
    def average_tokens_per_request(self) -> float:
        """Calculate average tokens per request."""
        if self.total_requests == 0:
            return 0.0
        return self.total_tokens / self.total_requests

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "credential_id": self.credential_id,
            "total_requests": self.total_requests,
            "total_tokens": self.total_tokens,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_creation_tokens": self.cache_creation_tokens,
            "last_used": self.last_used.isoformat() if self.last_used else None,
            "average_tokens_per_request": self.average_tokens_per_request,
        }

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"UsageSnapshot(credential_id={self.credential_id!r}, "
            f"total_requests={self.total_requests}, "
            f"total_tokens={self.total_tokens})"
        )


class UsageTracker:
    """
    Tracks and aggregates token usage per credential.

    This class provides methods for:
    - Capturing token usage from SDK responses
    - Aggregating usage metrics per credential
    - Storing usage data in Graphiti memory
    - Querying usage summaries for rotation decisions
    - Finding the least-used credential in a pool

    The tracker handles graceful degradation when Graphiti is unavailable
    by caching metrics locally in memory.

    Example:
        >>> tracker = UsageTracker(spec_dir, project_dir, memory)
        >>>
        >>> # Record usage from SDK response
        >>> usage = TokenUsage(
        ...     input_tokens=1000,
        ...     output_tokens=500,
        ...     cache_creation_input_tokens=200
        ... )
        >>> await tracker.record_usage("cred-001", usage)
        >>>
        >>> # Get usage summary
        >>> snapshot = await tracker.get_credential_usage("cred-001")
        >>> print(f"Total tokens: {snapshot.total_tokens}")
        >>>
        >>> # Find least-used credential
        >>> least_used = await tracker.get_least_used_credential(
        ...     ["cred-001", "cred-002", "cred-003"]
        ... )
    """

    def __init__(self, spec_dir: Path, project_dir: Path, memory: Any | None = None):
        """
        Initialize the usage tracker.

        Args:
            spec_dir: Spec directory for Graphiti namespace
            project_dir: Project root directory
            memory: Optional GraphitiMemory instance for persistent storage
        """
        self.spec_dir = spec_dir
        self.project_dir = project_dir
        self.memory = memory

        # In-memory cache for when Graphiti is unavailable
        self._cache: dict[str, UsageSnapshot] = {}

        # Track if we're using cache (for logging/debugging)
        self._using_cache = False

    def is_enabled(self) -> bool:
        """
        Check if persistent usage tracking is enabled.

        Returns:
            True if Graphiti memory is available and initialized
        """
        return self.memory is not None and self.memory.is_enabled

    async def record_usage(
        self, credential_id: str, usage: TokenUsage, metadata: dict[str, Any] | None = None
    ) -> bool:
        """
        Record token usage for a credential.

        Stores usage data in Graphiti memory with credential_usage episode type.
        If Graphiti is unavailable, caches the data locally in memory.

        Args:
            credential_id: ID of the credential that was used
            usage: TokenUsage data captured from SDK response
            metadata: Optional metadata (model name, agent type, etc.)

        Returns:
            True if usage was recorded successfully
        """
        try:
            # Update in-memory cache
            if credential_id not in self._cache:
                self._cache[credential_id] = UsageSnapshot(credential_id=credential_id)

            snapshot = self._cache[credential_id]
            snapshot.total_requests += 1
            snapshot.input_tokens += usage.input_tokens
            snapshot.output_tokens += usage.output_tokens
            snapshot.cache_read_tokens += usage.cache_read_tokens
            snapshot.cache_creation_tokens += usage.cache_creation_input_tokens
            snapshot.total_tokens += usage.total_tokens
            snapshot.last_used = datetime.now(timezone.utc)

            # Try to persist to Graphiti
            if self.is_enabled():
                from integrations.graphiti.queries_pkg.schema import (
                    EPISODE_TYPE_CREDENTIAL_USAGE,
                )

                episode_content = {
                    "type": EPISODE_TYPE_CREDENTIAL_USAGE,
                    "credential_id": credential_id,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "usage": usage.to_dict(),
                    "metadata": metadata or {},
                }

                # Import here to avoid hard dependency
                from graphiti_core.nodes import EpisodeType

                await self.memory._queries._client.graphiti.add_episode(
                    name=f"credential_usage_{credential_id}_{int(datetime.now(timezone.utc).timestamp())}",
                    episode_body=str(episode_content),  # Store as string for simplicity
                    source=EpisodeType.text,
                    source_description=f"Credential usage for {credential_id}",
                    reference_time=datetime.now(timezone.utc),
                    group_id=self.memory.group_id,
                )

                logger.debug(
                    f"Recorded usage for {credential_id}: {usage.total_tokens} tokens "
                    f"(persisted to Graphiti)"
                )
                self._using_cache = False
                return True
            else:
                logger.debug(
                    f"Recorded usage for {credential_id}: {usage.total_tokens} tokens "
                    f"(cached in memory only - Graphiti unavailable)"
                )
                self._using_cache = True
                return True

        except Exception as e:
            logger.warning(f"Failed to record usage for {credential_id}: {e}")
            # Still return True since we have it in cache
            self._using_cache = True
            return True

    async def get_credential_usage(self, credential_id: str) -> UsageSnapshot:
        """
        Get aggregated usage metrics for a specific credential.

        Returns cached usage data. If Graphiti is available, this will include
        persisted historical usage. Otherwise, returns session-local cache only.

        Args:
            credential_id: ID of the credential to query

        Returns:
            UsageSnapshot with aggregated metrics (empty if no usage recorded)
        """
        # Return from cache (may include Graphiti data if previously loaded)
        if credential_id in self._cache:
            return self._cache[credential_id]

        # Return empty snapshot if no usage recorded
        return UsageSnapshot(credential_id=credential_id)

    async def get_least_used_credential(
        self, credential_pool: list[str]
    ) -> str | None:
        """
        Find the credential with the lowest total usage from a pool.

        This is used by the usage_based rotation strategy to select the credential
        that has been used the least. Credentials with no usage are prioritized.

        Args:
            credential_pool: List of credential IDs to choose from

        Returns:
            ID of the least-used credential, or None if pool is empty
        """
        if not credential_pool:
            logger.warning("Cannot select least-used credential from empty pool")
            return None

        # Get usage snapshots for all credentials in pool
        snapshots = []
        for cred_id in credential_pool:
            snapshot = await self.get_credential_usage(cred_id)
            snapshots.append(snapshot)

        # Sort by total tokens (ascending), then by request count (ascending)
        snapshots.sort(key=lambda s: (s.total_tokens, s.total_requests))

        least_used = snapshots[0]
        logger.debug(
            f"Least-used credential: {least_used.credential_id} "
            f"({least_used.total_tokens} tokens, {least_used.total_requests} requests)"
        )

        return least_used.credential_id

    async def get_all_usage_summaries(self) -> dict[str, UsageSnapshot]:
        """
        Get usage summaries for all tracked credentials.

        Returns:
            Dictionary mapping credential IDs to their UsageSnapshots
        """
        return self._cache.copy()

    def clear_cache(self) -> None:
        """
        Clear the in-memory usage cache.

        This does not affect data stored in Graphiti (if available).
        Use with caution - this will reset session-local usage tracking.
        """
        self._cache.clear()
        logger.debug("Usage tracker cache cleared")

    async def aggregate_usage_by_time_range(
        self, credential_id: str, start_time: datetime, end_time: datetime
    ) -> UsageSnapshot:
        """
        Aggregate usage for a credential within a specific time range.

        Note: This is a placeholder for future implementation with Graphiti queries.
        Currently returns the full cached snapshot without time filtering.

        Args:
            credential_id: ID of the credential to query
            start_time: Start of time range (inclusive)
            end_time: End of time range (inclusive)

        Returns:
            UsageSnapshot with aggregated metrics for the time range
        """
        # TODO: Implement time-range filtering with Graphiti queries
        # For now, return the full snapshot
        snapshot = await self.get_credential_usage(credential_id)
        logger.debug(
            f"Time-range filtering not yet implemented, returning full snapshot for {credential_id}"
        )
        return snapshot

    def get_usage_summary_report(self) -> str:
        """
        Generate a human-readable summary of all credential usage.

        Returns:
            Formatted string with usage statistics for all tracked credentials
        """
        if not self._cache:
            return "No usage data available."

        lines = [
            "Credential Usage Summary",
            "=" * 50,
        ]

        for cred_id, snapshot in sorted(
            self._cache.items(), key=lambda x: x[1].total_tokens, reverse=True
        ):
            lines.append(
                f"\n{snapshot.credential_id}:\n"
                f"  Requests: {snapshot.total_requests}\n"
                f"  Total Tokens: {snapshot.total_tokens:,}\n"
                f"  Input: {snapshot.input_tokens:,} | "
                f"Output: {snapshot.output_tokens:,} | "
                f"Cache Read: {snapshot.cache_read_tokens:,}\n"
                f"  Avg Tokens/Request: {snapshot.average_tokens_per_request:.1f}\n"
                f"  Last Used: {snapshot.last_used.strftime('%Y-%m-%d %H:%M:%S UTC') if snapshot.last_used else 'Never'}"
            )

        lines.append(
            f"\nTotal Credentials Tracked: {len(self._cache)}\n"
            f"Data Source: {'Graphiti + Cache' if not self._using_cache else 'Cache Only (Graphiti unavailable)'}"
        )

        return "\n".join(lines)

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"UsageTracker(credentials_tracked={len(self._cache)}, "
            f"graphiti_enabled={self.is_enabled()})"
        )
