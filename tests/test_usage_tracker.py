#!/usr/bin/env python3
"""
Unit Tests for Usage Tracker
============================

Tests the token usage tracking functionality including:
- TokenUsage dataclass for single response usage
- UsageSnapshot dataclass for aggregated metrics
- UsageTracker class for tracking, storing, and querying usage
"""

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

from core.usage_tracker import TokenUsage, UsageSnapshot, UsageTracker


class TestTokenUsage:
    """Tests for TokenUsage dataclass."""

    def test_token_usage_default_values(self):
        """Creates TokenUsage with default zero values."""
        usage = TokenUsage()
        assert usage.input_tokens == 0
        assert usage.output_tokens == 0
        assert usage.cache_creation_input_tokens == 0
        assert usage.cache_read_tokens == 0
        assert usage.total_tokens == 0

    def test_token_usage_with_values(self):
        """Creates TokenUsage with specific token counts."""
        usage = TokenUsage(
            input_tokens=1000,
            output_tokens=500,
            cache_creation_input_tokens=200,
            cache_read_tokens=50,
        )
        assert usage.input_tokens == 1000
        assert usage.output_tokens == 500
        assert usage.cache_creation_input_tokens == 200
        assert usage.cache_read_tokens == 50
        assert usage.total_tokens == 1550  # 1000 + 500 + 50

    def test_total_tokens_property(self):
        """Calculates total tokens correctly (input + output + cache_read)."""
        usage = TokenUsage(
            input_tokens=1000,
            output_tokens=500,
            cache_read_tokens=100,
        )
        assert usage.total_tokens == 1600

    def test_total_tokens_excludes_cache_creation(self):
        """Total tokens excludes cache_creation_input_tokens."""
        usage = TokenUsage(
            input_tokens=1000,
            output_tokens=500,
            cache_creation_input_tokens=300,
            cache_read_tokens=100,
        )
        # Cache creation tokens are NOT included in total
        assert usage.total_tokens == 1600

    def test_to_dict(self):
        """Converts TokenUsage to dictionary representation."""
        usage = TokenUsage(
            input_tokens=1000,
            output_tokens=500,
            cache_creation_input_tokens=200,
            cache_read_tokens=50,
        )
        result = usage.to_dict()
        assert result == {
            "input_tokens": 1000,
            "output_tokens": 500,
            "cache_creation_input_tokens": 200,
            "cache_read_tokens": 50,
            "total_tokens": 1550,
        }


class TestUsageSnapshot:
    """Tests for UsageSnapshot dataclass."""

    def test_usage_snapshot_default_values(self):
        """Creates UsageSnapshot with default zero values."""
        snapshot = UsageSnapshot(credential_id="cred-001")
        assert snapshot.credential_id == "cred-001"
        assert snapshot.total_requests == 0
        assert snapshot.total_tokens == 0
        assert snapshot.input_tokens == 0
        assert snapshot.output_tokens == 0
        assert snapshot.cache_read_tokens == 0
        assert snapshot.cache_creation_tokens == 0
        assert snapshot.last_used is None

    def test_usage_snapshot_with_values(self):
        """Creates UsageSnapshot with specific usage metrics."""
        now = datetime.now(timezone.utc)
        snapshot = UsageSnapshot(
            credential_id="cred-001",
            total_requests=10,
            total_tokens=15000,
            input_tokens=10000,
            output_tokens=5000,
            cache_read_tokens=500,
            cache_creation_tokens=1000,
            last_used=now,
        )
        assert snapshot.credential_id == "cred-001"
        assert snapshot.total_requests == 10
        assert snapshot.total_tokens == 15000
        assert snapshot.input_tokens == 10000
        assert snapshot.output_tokens == 5000
        assert snapshot.cache_read_tokens == 500
        assert snapshot.cache_creation_tokens == 1000
        assert snapshot.last_used == now

    def test_average_tokens_per_request_zero_requests(self):
        """Average tokens per request is 0.0 when no requests."""
        snapshot = UsageSnapshot(credential_id="cred-001", total_requests=0)
        assert snapshot.average_tokens_per_request == 0.0

    def test_average_tokens_per_request_calculated(self):
        """Calculates average tokens per request correctly."""
        snapshot = UsageSnapshot(
            credential_id="cred-001",
            total_requests=10,
            total_tokens=15000,
        )
        assert snapshot.average_tokens_per_request == 1500.0

    def test_to_dict(self):
        """Converts UsageSnapshot to dictionary representation."""
        now = datetime.now(timezone.utc)
        snapshot = UsageSnapshot(
            credential_id="cred-001",
            total_requests=10,
            total_tokens=15000,
            input_tokens=10000,
            output_tokens=5000,
            cache_read_tokens=500,
            cache_creation_tokens=1000,
            last_used=now,
        )
        result = snapshot.to_dict()
        assert result["credential_id"] == "cred-001"
        assert result["total_requests"] == 10
        assert result["total_tokens"] == 15000
        assert result["input_tokens"] == 10000
        assert result["output_tokens"] == 5000
        assert result["cache_read_tokens"] == 500
        assert result["cache_creation_tokens"] == 1000
        assert result["last_used"] == now.isoformat()
        assert result["average_tokens_per_request"] == 1500.0

    def test_to_dict_no_last_used(self):
        """Converts UsageSnapshot to dict when last_used is None."""
        snapshot = UsageSnapshot(
            credential_id="cred-001",
            total_requests=0,
            total_tokens=0,
            last_used=None,
        )
        result = snapshot.to_dict()
        assert result["last_used"] is None

    def test_repr(self):
        """Returns string representation of UsageSnapshot."""
        snapshot = UsageSnapshot(
            credential_id="cred-001",
            total_requests=10,
            total_tokens=15000,
        )
        result = repr(snapshot)
        assert "cred-001" in result
        assert "10" in result
        assert "15000" in result


class TestUsageTracker:
    """Tests for UsageTracker class."""

    def test_init(self):
        """Initializes UsageTracker with spec and project directories."""
        spec_dir = Path("/spec")
        project_dir = Path("/project")
        tracker = UsageTracker(spec_dir, project_dir)

        assert tracker.spec_dir == spec_dir
        assert tracker.project_dir == project_dir
        assert tracker.memory is None
        assert tracker._cache == {}
        assert tracker._using_cache is False

    def test_init_with_memory(self):
        """Initializes UsageTracker with Graphiti memory."""
        spec_dir = Path("/spec")
        project_dir = Path("/project")
        memory = Mock()
        tracker = UsageTracker(spec_dir, project_dir, memory)

        assert tracker.memory == memory

    def test_is_enabled_no_memory(self):
        """is_enabled returns False when memory is None."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)
        assert tracker.is_enabled() is False

    def test_is_enabled_with_memory_disabled(self):
        """is_enabled returns False when memory.is_enabled is False."""
        memory = Mock()
        memory.is_enabled = False
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=memory)
        assert tracker.is_enabled() is False

    def test_is_enabled_with_memory_enabled(self):
        """is_enabled returns True when memory.is_enabled is True."""
        memory = Mock()
        memory.is_enabled = True
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=memory)
        assert tracker.is_enabled() is True

    @pytest.mark.asyncio
    async def test_record_usage_no_memory(self):
        """Records usage to in-memory cache when Graphiti is unavailable."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        usage = TokenUsage(
            input_tokens=1000,
            output_tokens=500,
            cache_read_tokens=100,
        )

        result = await tracker.record_usage("cred-001", usage)

        assert result is True
        assert "cred-001" in tracker._cache
        snapshot = tracker._cache["cred-001"]
        assert snapshot.total_requests == 1
        assert snapshot.total_tokens == 1600
        assert tracker._using_cache is True

    @pytest.mark.asyncio
    async def test_record_usage_with_memory(self):
        """Records usage to Graphiti when memory is available."""
        memory = Mock()
        memory.is_enabled = True
        memory.group_id = "test-group"
        memory._queries = Mock()
        memory._queries._client = Mock()
        memory._queries._client.graphiti = Mock()
        memory._queries._client.graphiti.add_episode = AsyncMock()

        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=memory)

        usage = TokenUsage(
            input_tokens=1000,
            output_tokens=500,
            cache_read_tokens=100,
        )

        result = await tracker.record_usage("cred-001", usage, metadata={"model": "claude-sonnet"})

        assert result is True
        assert tracker._using_cache is False
        # Verify Graphiti add_episode was called
        memory._queries._client.graphiti.add_episode.assert_called_once()

    @pytest.mark.asyncio
    async def test_record_usage_aggregates_multiple_requests(self):
        """Aggregates usage from multiple requests correctly."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        # First request
        usage1 = TokenUsage(input_tokens=1000, output_tokens=500)
        await tracker.record_usage("cred-001", usage1)

        # Second request
        usage2 = TokenUsage(input_tokens=2000, output_tokens=1000)
        await tracker.record_usage("cred-001", usage2)

        snapshot = tracker._cache["cred-001"]
        assert snapshot.total_requests == 2
        assert snapshot.total_tokens == 4500  # (1000+500) + (2000+1000)
        assert snapshot.input_tokens == 3000
        assert snapshot.output_tokens == 1500

    @pytest.mark.asyncio
    async def test_record_usage_with_metadata(self):
        """Records usage with optional metadata."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        usage = TokenUsage(input_tokens=1000, output_tokens=500)
        metadata = {
            "model": "claude-sonnet-4-5-20250929",
            "agent_type": "coder",
            "task_id": "task-123",
        }

        await tracker.record_usage("cred-001", usage, metadata=metadata)

        # Metadata doesn't affect aggregation, just stored
        snapshot = tracker._cache["cred-001"]
        assert snapshot.total_requests == 1

    @pytest.mark.asyncio
    async def test_record_usage_cache_tokens(self):
        """Records cache creation and cache read tokens separately."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        usage = TokenUsage(
            input_tokens=1000,
            output_tokens=500,
            cache_creation_input_tokens=200,
            cache_read_tokens=100,
        )

        await tracker.record_usage("cred-001", usage)

        snapshot = tracker._cache["cred-001"]
        assert snapshot.cache_creation_tokens == 200
        assert snapshot.cache_read_tokens == 100
        assert snapshot.total_tokens == 1600  # Input + Output + Cache Read (not creation)

    @pytest.mark.asyncio
    async def test_get_credential_usage_exists(self):
        """Returns usage snapshot for existing credential."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        usage = TokenUsage(input_tokens=1000, output_tokens=500)
        await tracker.record_usage("cred-001", usage)

        snapshot = await tracker.get_credential_usage("cred-001")
        assert snapshot.credential_id == "cred-001"
        assert snapshot.total_requests == 1
        assert snapshot.total_tokens == 1500

    @pytest.mark.asyncio
    async def test_get_credential_usage_not_exists(self):
        """Returns empty snapshot for non-existent credential."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        snapshot = await tracker.get_credential_usage("cred-999")
        assert snapshot.credential_id == "cred-999"
        assert snapshot.total_requests == 0
        assert snapshot.total_tokens == 0

    @pytest.mark.asyncio
    async def test_get_least_used_credential_empty_pool(self):
        """Returns None when credential pool is empty."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        result = await tracker.get_least_used_credential([])
        assert result is None

    @pytest.mark.asyncio
    async def test_get_least_used_credential_all_zero_usage(self):
        """Returns first credential when all have zero usage."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        pool = ["cred-001", "cred-002", "cred-003"]
        result = await tracker.get_least_used_credential(pool)

        # All have 0 tokens, returns first in list
        assert result in pool

    @pytest.mark.asyncio
    async def test_get_least_used_credential_one_used(self):
        """Returns credential with lowest usage."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        # Record usage for cred-001
        usage1 = TokenUsage(input_tokens=5000, output_tokens=2000)
        await tracker.record_usage("cred-001", usage1)

        pool = ["cred-001", "cred-002", "cred-003"]
        result = await tracker.get_least_used_credential(pool)

        # cred-002 or cred-003 should be selected (0 usage vs 7000)
        assert result in ["cred-002", "cred-003"]

    @pytest.mark.asyncio
    async def test_get_least_used_credential_multiple_used(self):
        """Selects credential with lowest usage from pool."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        # Record varying usage
        await tracker.record_usage("cred-001", TokenUsage(input_tokens=10000, output_tokens=5000))
        await tracker.record_usage("cred-002", TokenUsage(input_tokens=1000, output_tokens=500))
        await tracker.record_usage("cred-003", TokenUsage(input_tokens=5000, output_tokens=2000))

        pool = ["cred-001", "cred-002", "cred-003"]
        result = await tracker.get_least_used_credential(pool)

        # cred-002 has lowest usage (1500 tokens)
        assert result == "cred-002"

    @pytest.mark.asyncio
    async def test_get_least_used_credential_tie_breaker(self):
        """Breaks ties using request count when tokens are equal."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        # Both have same token usage
        await tracker.record_usage("cred-001", TokenUsage(input_tokens=1000, output_tokens=500))
        await tracker.record_usage("cred-002", TokenUsage(input_tokens=1000, output_tokens=500))
        await tracker.record_usage("cred-002", TokenUsage(input_tokens=500, output_tokens=0))
        # cred-001: 1500 tokens, 1 request
        # cred-002: 2000 tokens, 2 requests

        pool = ["cred-001", "cred-002"]
        result = await tracker.get_least_used_credential(pool)

        # cred-001 has fewer requests for same token usage
        assert result == "cred-001"

    @pytest.mark.asyncio
    async def test_get_all_usage_summaries(self):
        """Returns all tracked credential usage summaries."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        await tracker.record_usage("cred-001", TokenUsage(input_tokens=1000, output_tokens=500))
        await tracker.record_usage("cred-002", TokenUsage(input_tokens=2000, output_tokens=1000))
        await tracker.record_usage("cred-003", TokenUsage(input_tokens=500, output_tokens=250))

        summaries = await tracker.get_all_usage_summaries()

        assert len(summaries) == 3
        assert "cred-001" in summaries
        assert "cred-002" in summaries
        assert "cred-003" in summaries
        assert summaries["cred-001"].total_tokens == 1500
        assert summaries["cred-002"].total_tokens == 3000
        assert summaries["cred-003"].total_tokens == 750

    def test_clear_cache(self):
        """Clears the in-memory usage cache."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        # Add some data to cache (synchronously)
        tracker._cache["cred-001"] = UsageSnapshot(
            credential_id="cred-001",
            total_requests=10,
            total_tokens=15000,
        )

        assert len(tracker._cache) == 1

        tracker.clear_cache()

        assert len(tracker._cache) == 0

    @pytest.mark.asyncio
    async def test_aggregate_usage_by_time_range(self):
        """Aggregates usage within time range (placeholder implementation)."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        await tracker.record_usage("cred-001", TokenUsage(input_tokens=1000, output_tokens=500))

        start_time = datetime.now(timezone.utc)
        end_time = datetime.now(timezone.utc)

        # Currently returns full snapshot without time filtering
        result = await tracker.aggregate_usage_by_time_range("cred-001", start_time, end_time)

        assert result.credential_id == "cred-001"
        assert result.total_tokens == 1500

    def test_get_usage_summary_report_empty(self):
        """Returns 'No usage data available' when cache is empty."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        report = tracker.get_usage_summary_report()

        assert report == "No usage data available."

    def test_get_usage_summary_report_with_data(self):
        """Generates formatted usage summary report."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        # Add usage data
        tracker._cache["cred-001"] = UsageSnapshot(
            credential_id="cred-001",
            total_requests=10,
            total_tokens=15000,
            input_tokens=10000,
            output_tokens=5000,
            cache_read_tokens=500,
            cache_creation_tokens=1000,
            last_used=datetime.now(timezone.utc),
        )
        tracker._cache["cred-002"] = UsageSnapshot(
            credential_id="cred-002",
            total_requests=5,
            total_tokens=3000,
            input_tokens=2000,
            output_tokens=1000,
            cache_read_tokens=100,
            cache_creation_tokens=200,
            last_used=datetime.now(timezone.utc),
        )

        report = tracker.get_usage_summary_report()

        assert "Credential Usage Summary" in report
        assert "cred-001" in report
        assert "cred-002" in report
        assert "15,000" in report  # Total tokens for cred-001
        assert "3,000" in report  # Total tokens for cred-002
        assert "Total Credentials Tracked: 2" in report

    def test_get_usage_summary_report_sorted_by_usage(self):
        """Sorts credentials by total tokens in descending order."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        tracker._cache["cred-low"] = UsageSnapshot(
            credential_id="cred-low",
            total_tokens=1000,
            total_requests=1,
        )
        tracker._cache["cred-high"] = UsageSnapshot(
            credential_id="cred-high",
            total_tokens=5000,
            total_requests=5,
        )
        tracker._cache["cred-medium"] = UsageSnapshot(
            credential_id="cred-medium",
            total_tokens=3000,
            total_requests=3,
        )

        report = tracker.get_usage_summary_report()

        # Check order in report (high to low)
        lines = report.split("\n")
        cred_high_line = next(i for i, line in enumerate(lines) if "cred-high" in line)
        cred_medium_line = next(i for i, line in enumerate(lines) if "cred-medium" in line)
        cred_low_line = next(i for i, line in enumerate(lines) if "cred-low" in line)

        assert cred_high_line < cred_medium_line < cred_low_line

    def test_repr(self):
        """Returns string representation of UsageTracker."""
        tracker = UsageTracker(Path("/spec"), Path("/project"), memory=None)

        # Add some credentials to cache
        tracker._cache["cred-001"] = UsageSnapshot(credential_id="cred-001")
        tracker._cache["cred-002"] = UsageSnapshot(credential_id="cred-002")

        result = repr(tracker)
        assert "UsageTracker" in result
        assert "credentials_tracked=2" in result
        assert "graphiti_enabled=False" in result
