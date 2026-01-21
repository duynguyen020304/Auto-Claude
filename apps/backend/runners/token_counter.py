#!/usr/bin/env python3
"""
Token Counter Module - Count tokens for context budget management

This module provides functionality to count tokens using tiktoken for accurate
token budget management in file context injection. Used to ensure file contents
stay within token limits and make smart truncation decisions.

Examples:
    >>> count_tokens("Hello world")
    2

    >>> budget = TokenBudget(max_tokens=50000)
    >>> budget.add_usage(count_tokens("file content"))
    >>> budget.remaining_tokens
    49994
"""

from dataclasses import dataclass, field
from typing import Optional


# Default encoding for Claude models (claudetoken is similar to cl100k_base)
DEFAULT_ENCODING = "cl100k_base"

# Default token budget for file context (from spec)
DEFAULT_TOKEN_BUDGET = 50000


def get_encoding(encoding_name: str = DEFAULT_ENCODING):
    """
    Get tiktoken encoding instance.

    Args:
        encoding_name: Name of the tiktoken encoding (default: cl100k_base)

    Returns:
        tiktoken.Encoding object

    Note:
        This function lazy-loads tiktoken to avoid overhead when not needed.
        The encoding is cached per encoding_name for performance.
    """
    try:
        import tiktoken

        return tiktoken.get_encoding(encoding_name)
    except ImportError:
        raise ImportError(
            "tiktoken is required for token counting. "
            "Install it with: pip install tiktoken"
        )
    except Exception as e:
        raise RuntimeError(f"Failed to load tiktoken encoding: {e}")


def count_tokens(text: str, encoding_name: str = DEFAULT_ENCODING) -> int:
    """
    Count tokens in text using tiktoken.

    Args:
        text: Text to count tokens for
        encoding_name: Name of the tiktoken encoding (default: cl100k_base)

    Returns:
        Number of tokens in the text

    Examples:
        >>> count_tokens("Hello world")
        2

        >>> count_tokens("def hello():\\n    print('world')\\n")
        8
    """
    if not text:
        return 0

    try:
        encoding = get_encoding(encoding_name)
        # Encode text to tokens and count
        tokens = encoding.encode(text)
        return len(tokens)
    except Exception as e:
        # Fallback: estimate tokens (rough approximation: 1 token ≈ 4 characters)
        # This is less accurate but prevents crashes on encoding errors
        return len(text) // 4


def count_tokens_for_file_context(
    file_path: str,
    content: str,
    encoding_name: str = DEFAULT_ENCODING,
) -> dict:
    """
    Count tokens for file context including metadata overhead.

    Args:
        file_path: Path to the file (for display)
        content: File content to count tokens for
        encoding_name: Name of the tiktoken encoding

    Returns:
        Dictionary with token counts:
        - content_tokens: Tokens for file content
        - metadata_tokens: Estimated tokens for metadata (path, line count info)
        - total_tokens: Total tokens including metadata

    Examples:
        >>> result = count_tokens_for_file_context("src/App.tsx", "export default ...")
        >>> result['content_tokens']
        150
        >>> result['total_tokens']
        165
    """
    content_tokens = count_tokens(content, encoding_name)

    # Estimate metadata tokens (file path, line count, encoding info)
    # Format: "File: {path}\nLines: {count}\nEncoding: {encoding}\n"
    metadata_text = f"File: {file_path}\nLines: {content.count(chr(10)) + 1}\n"
    metadata_tokens = count_tokens(metadata_text, encoding_name)

    return {
        "content_tokens": content_tokens,
        "metadata_tokens": metadata_tokens,
        "total_tokens": content_tokens + metadata_tokens,
    }


@dataclass
class TokenBudget:
    """
    Track token budget for file context management.

    Attributes:
        max_tokens: Maximum tokens allowed (default: 50000 from spec)
        used_tokens: Tokens currently used
        encoding_name: tiktoken encoding name

    Examples:
        >>> budget = TokenBudget(max_tokens=1000)
        >>> budget.can_fit(500)
        True
        >>> budget.add_usage(500)
        >>> budget.can_fit(600)
        False
    """

    max_tokens: int = DEFAULT_TOKEN_BUDGET
    used_tokens: int = 0
    encoding_name: str = DEFAULT_ENCODING

    @property
    def remaining_tokens(self) -> int:
        """Get remaining tokens in budget."""
        return max(0, self.max_tokens - self.used_tokens)

    @property
    def usage_percentage(self) -> float:
        """Get usage as a percentage (0-100)."""
        if self.max_tokens == 0:
            return 100.0
        return min(100.0, (self.used_tokens / self.max_tokens) * 100)

    @property
    def is_over_budget(self) -> bool:
        """Check if budget is exceeded."""
        return self.used_tokens > self.max_tokens

    @property
    def is_near_budget_limit(self, threshold: float = 0.9) -> bool:
        """
        Check if usage is near budget limit.

        Args:
            threshold: Threshold percentage (default: 0.9 = 90%)

        Returns:
            True if usage is at or above threshold
        """
        return self.usage_percentage >= (threshold * 100)

    def can_fit(self, tokens: int) -> bool:
        """
        Check if given tokens can fit in remaining budget.

        Args:
            tokens: Number of tokens to check

        Returns:
            True if tokens fit within budget
        """
        return (self.used_tokens + tokens) <= self.max_tokens

    def add_usage(self, tokens: int) -> int:
        """
        Add tokens to usage.

        Args:
            tokens: Number of tokens to add

        Returns:
            New used_tokens count

        Raises:
            ValueError: If tokens would exceed budget significantly (>10% over)
        """
        new_usage = self.used_tokens + tokens

        # Allow slight overage (up to 10%) but warn if exceeded
        if new_usage > (self.max_tokens * 1.1):
            raise ValueError(
                f"Token budget exceeded significantly: "
                f"{new_usage} > {self.max_tokens * 1.1} (110% of budget)"
            )

        self.used_tokens = new_usage
        return self.used_tokens

    def reset(self) -> None:
        """Reset token usage to zero."""
        self.used_tokens = 0

    def get_summary(self) -> str:
        """
        Get human-readable budget summary.

        Returns:
            Summary string like "25000/50000 tokens (50%)"
        """
        return (
            f"{self.used_tokens:,}/{self.max_tokens:,} tokens "
            f"({self.usage_percentage:.1f}%)"
        )


def estimate_tokens_for_lines(
    lines: list[str],
    encoding_name: str = DEFAULT_ENCODING,
) -> int:
    """
    Estimate tokens for a list of lines.

    Args:
        lines: List of text lines
        encoding_name: tiktoken encoding name

    Returns:
        Estimated token count for all lines

    Examples:
        >>> lines = ["def foo():", "    pass", ""]
        >>> estimate_tokens_for_lines(lines)
        6
    """
    if not lines:
        return 0

    # Join lines and count tokens
    content = "".join(lines)
    return count_tokens(content, encoding_name)


def find_truncation_point(
    lines: list[str],
    max_tokens: int,
    encoding_name: str = DEFAULT_ENCODING,
    keep_end: int = 100,
) -> tuple[int, bool]:
    """
    Find where to truncate a file to stay within token limit.

    Uses smart truncation strategy: first N lines + truncation marker + last M lines.

    Args:
        lines: All lines from the file
        max_tokens: Maximum tokens allowed
        encoding_name: tiktoken encoding name
        keep_end: Number of lines to keep from end

    Returns:
        Tuple of (truncation_line_count, needs_truncation)
        - truncation_line_count: Number of lines to include from start
        - needs_truncation: True if truncation is needed

    Examples:
        >>> lines = ["line"] * 1000  # Large file
        >>> count, truncate = find_truncation_point(lines, max_tokens=1000)
        >>> truncate
        True
        >>> count  # Number of lines from start to keep
        750
    """
    total_tokens = estimate_tokens_for_lines(lines, encoding_name)

    # If entire file fits, no truncation needed
    if total_tokens <= max_tokens:
        return len(lines), False

    # Binary search for truncation point
    # We want to keep first N lines + truncation marker + last keep_end lines
    # The truncation marker itself costs tokens

    truncation_marker = f"\n[... {len(lines)} lines truncated ...]\n"
    marker_tokens = count_tokens(truncation_marker, encoding_name)

    # Estimate tokens for last keep_end lines
    end_lines = lines[-keep_end:] if keep_end > 0 else []
    end_tokens = estimate_tokens_for_lines(end_lines, encoding_name)

    # Remaining budget for start lines
    available_for_start = max_tokens - marker_tokens - end_tokens

    if available_for_start <= 0:
        # Can't even fit end lines + marker
        return 0, True

    # Find max lines from start that fit within available_for_start tokens
    # Use binary search for efficiency
    left, right = 0, len(lines)
    best_count = 0

    while left < right:
        mid = (left + right + 1) // 2
        test_lines = lines[:mid]
        test_tokens = estimate_tokens_for_lines(test_lines, encoding_name)

        if test_tokens <= available_for_start:
            best_count = mid
            left = mid
        else:
            right = mid - 1

    return best_count, True


def calculate_budget_distribution(
    file_counts: list[dict],
    max_budget: int = DEFAULT_TOKEN_BUDGET,
    encoding_name: str = DEFAULT_ENCODING,
) -> dict:
    """
    Calculate how to distribute token budget across multiple files.

    Args:
        file_counts: List of token counts from count_tokens_for_file_context()
        max_budget: Total token budget
        encoding_name: tiktoken encoding name

    Returns:
        Dictionary with:
        - fits: True if all files fit within budget
        - total_tokens: Total tokens needed
        - files_to_truncate: List of indices for files that need truncation
        - suggested_distribution: Dict mapping file_index → max_tokens

    Examples:
        >>> counts = [
        ...     count_tokens_for_file_context("file1.py", "content1"),
        ...     count_tokens_for_file_context("file2.py", "content2"),
        ... ]
        >>> result = calculate_budget_distribution(counts, max_budget=1000)
        >>> result['fits']
        True
    """
    total_tokens = sum(fc["total_tokens"] for fc in file_counts)
    fits = total_tokens <= max_budget

    # If files don't fit, identify which to truncate
    files_to_truncate = []
    suggested_distribution = {}

    if not fits:
        # Strategy: Truncate largest files first
        # Sort by token count (descending)
        sorted_indices = sorted(
            range(len(file_counts)),
            key=lambda i: file_counts[i]["total_tokens"],
            reverse=True,
        )

        # Allocate budget evenly, then largest files get truncated
        remaining_budget = max_budget
        per_file_budget = max_budget // len(file_counts)

        for idx in sorted_indices:
            file_token_count = file_counts[idx]["total_tokens"]
            if file_token_count <= per_file_budget:
                suggested_distribution[idx] = file_token_count
                remaining_budget -= file_token_count
            else:
                suggested_distribution[idx] = per_file_budget
                files_to_truncate.append(idx)
                remaining_budget -= per_file_budget

    return {
        "fits": fits,
        "total_tokens": total_tokens,
        "files_to_truncate": files_to_truncate,
        "suggested_distribution": suggested_distribution,
    }
