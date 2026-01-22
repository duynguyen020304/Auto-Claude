"""
Credential management data models for Auto Claude.

Provides unified credential abstraction that normalizes API keys and OAuth tokens,
with support for multiple credential profiles, rotation strategies, and usage tracking.
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Literal

logger = logging.getLogger(__name__)


class CredentialType(str, Enum):
    """Types of credentials supported by Auto Claude."""

    API_KEY = "api_key"
    OAUTH = "oauth"


class CredentialStatus(str, Enum):
    """Status of a credential profile."""

    ACTIVE = "active"
    RATE_LIMITED = "rate_limited"
    DISABLED = "disabled"


class RotationMode(str, Enum):
    """Rotation mode for credential selection."""

    MANUAL = "manual"
    ROUND_ROBIN = "round_robin"
    USAGE_BASED = "usage_based"
    RATE_LIMIT_AWARE = "rate_limit_aware"


@dataclass
class RotationConfig:
    """
    Configuration for credential rotation strategy.

    Attributes:
        mode: Rotation mode to use (manual, round_robin, usage_based, rate_limit_aware)
        credential_pool: List of credential IDs to rotate through
        rate_limit_threshold: Threshold (0.0-1.0) for rate_limit_aware mode to rotate before hitting limits
        max_retries: Maximum number of retry attempts when swapping credentials on errors
        retry_delay_seconds: Delay between retry attempts
    """

    mode: RotationMode
    credential_pool: list[str] = field(default_factory=list)
    rate_limit_threshold: float = 0.8
    max_retries: int = 3
    retry_delay_seconds: int = 1

    def __post_init__(self):
        """Validate configuration after initialization."""
        if not 0.0 <= self.rate_limit_threshold <= 1.0:
            raise ValueError(
                f"rate_limit_threshold must be between 0.0 and 1.0, got {self.rate_limit_threshold}"
            )
        if self.max_retries < 0:
            raise ValueError(
                f"max_retries must be non-negative, got {self.max_retries}"
            )
        if self.retry_delay_seconds < 0:
            raise ValueError(
                f"retry_delay_seconds must be non-negative, got {self.retry_delay_seconds}"
            )

    def is_enabled(self) -> bool:
        """
        Check if credential rotation is enabled.

        Returns:
            True if rotation is enabled (pool has multiple credentials), False otherwise
        """
        return len(self.credential_pool) > 1

    def get_effective_pool(self) -> list[str]:
        """
        Get the effective credential pool for rotation.

        Returns:
            List of credential IDs. If pool is empty, returns empty list.
        """
        return self.credential_pool.copy()

    def should_rotate_proactively(self, current_usage: float, limit: float) -> bool:
        """
        Check if rotation should occur proactively based on usage.

        Used by rate_limit_aware mode to determine when to rotate before hitting limits.

        Args:
            current_usage: Current usage level (e.g., tokens used)
            limit: Usage limit (e.g., TPM/RPM limit)

        Returns:
            True if usage exceeds threshold, False otherwise
        """
        if limit == 0:
            return False
        usage_ratio = current_usage / limit
        return usage_ratio >= self.rate_limit_threshold

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"RotationConfig(mode={self.mode.value!r}, "
            f"pool_size={len(self.credential_pool)}, "
            f"threshold={self.rate_limit_threshold})"
        )


@dataclass
class RateLimitInfo:
    """
    Rate limit information for a credential.

    Attributes:
        requests_per_minute: Maximum requests per minute allowed
        tokens_per_minute: Maximum tokens per minute allowed
        remaining_requests: Remaining requests in current window
        remaining_tokens: Remaining tokens in current window
        reset_at: Timestamp when rate limit window resets
    """

    requests_per_minute: int | None = None
    tokens_per_minute: int | None = None
    remaining_requests: int | None = None
    remaining_tokens: int | None = None
    reset_at: datetime | None = None


@dataclass
class UsageMetrics:
    """
    Usage metrics for a credential profile.

    Attributes:
        total_requests: Total number of API requests made
        total_tokens: Total tokens consumed (input + output)
        input_tokens: Total input tokens
        output_tokens: Total output tokens
        cache_read_tokens: Total cache read tokens
        cache_creation_tokens: Total cache creation tokens
        last_used: Timestamp of last usage
    """

    total_requests: int = 0
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    last_used: datetime | None = None


@dataclass
class CredentialProfile:
    """
    Unified credential profile that normalizes API keys and OAuth tokens.

    This data model provides a single abstraction for different credential types,
    supporting both API keys (ANTHROPIC_API_KEY) and OAuth tokens (CLAUDE_CODE_OAUTH_TOKEN).
    Each profile includes metadata for rotation, usage tracking, and rate limit handling.

    Attributes:
        id: Unique identifier for this credential profile (e.g., "cred-001")
        type: Type of credential ('api_key' or 'oauth')
        name: Human-readable name for this credential
        status: Current status ('active', 'rate_limited', 'disabled')
        credential_value: The actual credential value (token or API key)
        usage_metrics: Token usage tracking data
        rate_limit_info: Rate limit information (if known)
        last_validated: Timestamp of last validation check
        created_at: Timestamp when profile was created
        metadata: Additional metadata (optional)

    Example:
        >>> profile = CredentialProfile(
        ...     id="cred-001",
        ...     type=CredentialType.OAUTH,
        ...     name="Primary Claude Account",
        ...     status=CredentialStatus.ACTIVE,
        ...     credential_value="sk-ant-oat01-..."
        ... )
    """

    id: str
    type: CredentialType
    name: str
    status: CredentialStatus
    credential_value: str
    usage_metrics: UsageMetrics = field(default_factory=UsageMetrics)
    rate_limit_info: RateLimitInfo | None = None
    last_validated: datetime | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    metadata: dict[str, str] | None = None

    def is_active(self) -> bool:
        """
        Check if this credential is currently active and available for use.

        Returns:
            True if status is 'active', False otherwise
        """
        return self.status == CredentialStatus.ACTIVE

    def is_rate_limited(self) -> bool:
        """
        Check if this credential is currently rate-limited.

        Returns:
            True if status is 'rate_limited', False otherwise
        """
        return self.status == CredentialStatus.RATE_LIMITED

    def is_disabled(self) -> bool:
        """
        Check if this credential is disabled.

        Returns:
            True if status is 'disabled', False otherwise
        """
        return self.status == CredentialStatus.DISABLED

    def can_be_used(self) -> bool:
        """
        Check if this credential can be used for API requests.

        A credential can be used if it is active and not rate-limited.

        Returns:
            True if credential is available for use, False otherwise
        """
        return self.is_active()

    def mark_rate_limited(self) -> None:
        """Mark this credential as rate-limited."""
        self.status = CredentialStatus.RATE_LIMITED
        logger.warning(f"Credential {self.id} ({self.name}) marked as rate-limited")

    def mark_disabled(self, reason: str) -> None:
        """
        Mark this credential as disabled.

        Args:
            reason: Reason for disabling the credential
        """
        self.status = CredentialStatus.DISABLED
        logger.warning(f"Credential {self.id} ({self.name}) disabled: {reason}")

    def mark_active(self) -> None:
        """Mark this credential as active and available for use."""
        self.status = CredentialStatus.ACTIVE
        logger.info(f"Credential {self.id} ({self.name}) marked as active")

    def record_usage(
        self,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_read_tokens: int = 0,
        cache_creation_tokens: int = 0,
    ) -> None:
        """
        Record API usage for this credential.

        Args:
            input_tokens: Number of input tokens consumed
            output_tokens: Number of output tokens consumed
            cache_read_tokens: Number of cache read tokens
            cache_creation_tokens: Number of cache creation tokens
        """
        self.usage_metrics.total_requests += 1
        self.usage_metrics.input_tokens += input_tokens
        self.usage_metrics.output_tokens += output_tokens
        self.usage_metrics.cache_read_tokens += cache_read_tokens
        self.usage_metrics.cache_creation_tokens += cache_creation_tokens

        # Update total tokens
        total_tokens = input_tokens + output_tokens + cache_read_tokens
        self.usage_metrics.total_tokens += total_tokens

        # Update last used timestamp
        self.usage_metrics.last_used = datetime.utcnow()

        logger.debug(
            f"Credential {self.id} usage: +{total_tokens} tokens "
            f"(total: {self.usage_metrics.total_tokens})"
        )

    def get_usage_summary(self) -> dict[str, int | str | None]:
        """
        Get a summary of usage metrics for this credential.

        Returns:
            Dictionary containing usage metrics summary
        """
        return {
            "credential_id": self.id,
            "credential_name": self.name,
            "total_requests": self.usage_metrics.total_requests,
            "total_tokens": self.usage_metrics.total_tokens,
            "input_tokens": self.usage_metrics.input_tokens,
            "output_tokens": self.usage_metrics.output_tokens,
            "cache_read_tokens": self.usage_metrics.cache_read_tokens,
            "last_used": self.usage_metrics.last_used.isoformat()
            if self.usage_metrics.last_used
            else None,
        }

    def validate_credential_format(self) -> bool:
        """
        Validate the format of the credential value.

        Checks if the credential value matches expected format:
        - OAuth tokens: start with "sk-ant-oat01-"
        - API keys: start with "sk-ant-api03-"

        Returns:
            True if format is valid, False otherwise
        """
        if not self.credential_value:
            return False

        if self.type == CredentialType.OAUTH:
            # OAuth tokens start with sk-ant-oat01-
            return self.credential_value.startswith("sk-ant-oat01-")
        elif self.type == CredentialType.API_KEY:
            # API keys start with sk-ant-api03-
            return self.credential_value.startswith("sk-ant-api03-")

        return False

    def __repr__(self) -> str:
        """Return string representation (with credential value redacted)."""
        return (
            f"CredentialProfile(id={self.id!r}, type={self.type.value!r}, "
            f"name={self.name!r}, status={self.status.value!r}, "
            f"usage_metrics={self.usage_metrics})"
        )


@dataclass
class Pool:
    """
    A pool of credential profiles with rotation configuration.

    A pool groups multiple credential profiles together and defines how they
    should be rotated during usage. This enables load balancing, rate limit
    avoidance, and high availability through automatic credential rotation.

    Attributes:
        id: Unique identifier for this pool (e.g., "pool-001")
        name: Human-readable name for this pool
        profile_ids: List of credential profile IDs in this pool
        limit: Maximum number of profiles to use from this pool (0 = no limit)
        rotation_config: Configuration for credential rotation strategy

    Example:
        >>> pool = Pool(
        ...     id="pool-001",
        ...     name="Production Claude Pool",
        ...     profile_ids=["cred-001", "cred-002", "cred-003"],
        ...     limit=2,
        ...     rotation_config=RotationConfig(mode=RotationMode.ROUND_ROBIN)
        ... )
    """

    id: str
    name: str
    profile_ids: list[str] = field(default_factory=list)
    limit: int = 0
    rotation_config: RotationConfig = field(default_factory=lambda: RotationConfig(mode=RotationMode.MANUAL))

    def __post_init__(self):
        """Validate pool configuration after initialization."""
        if self.limit < 0:
            raise ValueError(
                f"limit must be non-negative, got {self.limit}"
            )
        if not self.id:
            raise ValueError("Pool ID cannot be empty")
        if not self.name:
            raise ValueError("Pool name cannot be empty")

    def is_empty(self) -> bool:
        """
        Check if this pool has no credential profiles.

        Returns:
            True if pool has no profiles, False otherwise
        """
        return len(self.profile_ids) == 0

    def get_effective_profiles(self) -> list[str]:
        """
        Get the effective list of profile IDs to use from this pool.

        If limit is set and greater than 0, returns up to that many profiles.
        Otherwise, returns all profiles in the pool.

        Returns:
            List of credential profile IDs to use
        """
        if self.limit > 0:
            return self.profile_ids[:self.limit]
        return self.profile_ids.copy()

    def has_profile(self, profile_id: str) -> bool:
        """
        Check if a specific profile ID is in this pool.

        Args:
            profile_id: Credential profile ID to check

        Returns:
            True if profile is in the pool, False otherwise
        """
        return profile_id in self.profile_ids

    def add_profile(self, profile_id: str) -> None:
        """
        Add a credential profile to this pool.

        Args:
            profile_id: Credential profile ID to add
        """
        if profile_id not in self.profile_ids:
            self.profile_ids.append(profile_id)
            logger.debug(f"Added profile {profile_id} to pool {self.id}")

    def remove_profile(self, profile_id: str) -> bool:
        """
        Remove a credential profile from this pool.

        Args:
            profile_id: Credential profile ID to remove

        Returns:
            True if profile was removed, False if not found
        """
        if profile_id in self.profile_ids:
            self.profile_ids.remove(profile_id)
            logger.debug(f"Removed profile {profile_id} from pool {self.id}")
            return True
        return False

    def get_profile_count(self) -> int:
        """
        Get the number of profiles in this pool.

        Returns:
            Number of credential profiles
        """
        return len(self.profile_ids)

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"Pool(id={self.id!r}, name={self.name!r}, "
            f"profiles={len(self.profile_ids)}, limit={self.limit}, "
            f"rotation_mode={self.rotation_config.mode.value!r})"
        )


class CredentialStorage(ABC):
    """
    Abstract interface for platform-specific credential storage.

    This interface defines the contract for storing and retrieving credentials
    across different platforms (macOS Keychain, Windows Credential Manager,
    Linux Secret Service, and file-based fallback).

    Implementations must provide methods for:
    - Saving credentials with metadata
    - Loading credentials by ID or listing all
    - Deleting credentials
    - Updating credential status (for rate limiting)

    All operations should handle platform-specific error conditions gracefully,
    logging errors and returning None or False rather than raising exceptions
    for expected failure modes (missing credentials, permission denied, etc.).

    Example:
        >>> storage = KeychainStorage()  # Platform-specific implementation
        >>> storage.save_profile(credential_profile)
        >>> profile = storage.load_profile("cred-001")
    """

    @abstractmethod
    def save_profile(self, profile: CredentialProfile) -> bool:
        """
        Save a credential profile to platform storage.

        Stores the credential profile along with its metadata. If a profile
        with the same ID already exists, it will be overwritten.

        Args:
            profile: CredentialProfile to save

        Returns:
            True if save was successful, False otherwise

        Raises:
            PermissionError: If insufficient permissions to access storage
            ValueError: If profile data is invalid
        """
        pass

    @abstractmethod
    def load_profile(self, profile_id: str) -> CredentialProfile | None:
        """
        Load a credential profile by ID from platform storage.

        Args:
            profile_id: Unique identifier for the credential profile

        Returns:
            CredentialProfile if found, None otherwise
        """
        pass

    @abstractmethod
    def list_profiles(self) -> list[CredentialProfile]:
        """
        List all credential profiles in platform storage.

        Returns:
            List of all CredentialProfile objects (empty list if none found)

        Note:
            This should return all profiles regardless of their status
            (active, rate_limited, disabled).
        """
        pass

    @abstractmethod
    def delete_profile(self, profile_id: str) -> bool:
        """
        Delete a credential profile from platform storage.

        Args:
            profile_id: Unique identifier for the credential profile

        Returns:
            True if profile was deleted, False if not found or deletion failed
        """
        pass

    @abstractmethod
    def update_status(
        self, profile_id: str, status: CredentialStatus, reason: str | None = None
    ) -> bool:
        """
        Update the status of a credential profile.

        Used for marking credentials as rate_limited or disabled during
        API rotation operations.

        Args:
            profile_id: Unique identifier for the credential profile
            status: New status to set
            reason: Optional reason for status change (logged for audit)

        Returns:
            True if status was updated, False if profile not found or update failed
        """
        pass

    def profile_exists(self, profile_id: str) -> bool:
        """
        Check if a credential profile exists in storage.

        Args:
            profile_id: Unique identifier for the credential profile

        Returns:
            True if profile exists, False otherwise
        """
        return self.load_profile(profile_id) is not None
