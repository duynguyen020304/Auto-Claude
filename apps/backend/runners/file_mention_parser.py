#!/usr/bin/env python3
"""
File Mention Parser - Extract @ mentions with line ranges from text

This module provides functionality to parse file mentions from user messages,
supporting both relative and absolute paths with optional line ranges.

Examples:
    @filename
    @/path/to/file
    @file.js:10-50
    @src/component.tsx:100
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


@dataclass
class FileMention:
    """Represents a file mention extracted from text."""

    file_path: str  # Original file path as mentioned
    line_start: Optional[int] = None  # 1-based line number (user-facing)
    line_end: Optional[int] = None  # 1-based line number (user-facing)

    @property
    def has_line_range(self) -> bool:
        """Check if mention has a line range specified."""
        return self.line_start is not None

    def __str__(self) -> str:
        """String representation of the mention."""
        result = f"@{self.file_path}"
        if self.line_start is not None:
            if self.line_end is not None:
                result += f":{self.line_start}-{self.line_end}"
            else:
                result += f":{self.line_start}"
        return result


# Regex pattern to match file mentions
# Pattern breakdown:
# @(?P<path>[^:\s]+)  - Match @ followed by file path (no colons or whitespace)
# (?::(?P<lines>\d+(?:-\d*)?))? - Optional : followed by line numbers (single, range, or open range)
FILE_MENTION_PATTERN = re.compile(
    r"@(?P<path>[^:\s]+)(?::(?P<lines>\d+(?:-\d*)?))?"
)


def parse_mentions(text: str) -> List[FileMention]:
    """
    Extract file mentions from text.

    Args:
        text: User message text to parse

    Returns:
        List of FileMention objects found in the text

    Examples:
        >>> parse_mentions("Check @src/App.tsx and @README.md")
        [FileMention(file_path='src/App.tsx'), FileMention(file_path='README.md')]

        >>> parse_mentions("See @file.js:10-50 for details")
        [FileMention(file_path='file.js', line_start=10, line_end=50)]
    """
    mentions = []
    for match in FILE_MENTION_PATTERN.finditer(text):
        path = match.group("path")
        lines_str = match.group("lines")

        # Normalize Windows paths (backslashes to forward slashes)
        path = path.replace("\\", "/")

        # Parse line range
        line_start = None
        line_end = None

        if lines_str:
            if "-" in lines_str:
                # Range: 10-50 or 10- (open range)
                parts = lines_str.split("-", 1)
                line_start = int(parts[0]) if parts[0] else None
                line_end = int(parts[1]) if parts[1] else None
            else:
                # Single line: 10
                line_start = int(lines_str)
                line_end = line_start

        mentions.append(FileMention(file_path=path, line_start=line_start, line_end=line_end))

    return mentions


def normalize_path(file_path: str, project_dir: str) -> str:
    """
    Normalize file path relative to project directory.

    Args:
        file_path: File path from mention (relative or absolute)
        project_dir: Project root directory

    Returns:
        Normalized absolute path

    Examples:
        >>> normalize_path("src/App.tsx", "/home/user/project")
        "/home/user/project/src/App.tsx"

        >>> normalize_path("/home/user/project/README.md", "/home/user/project")
        "/home/user/project/README.md"
    """
    project_path = Path(project_dir).resolve()
    mention_path = Path(file_path)

    # If path is absolute, use it directly
    if mention_path.is_absolute():
        normalized = mention_path.resolve()
    else:
        # Relative path - resolve from project directory
        normalized = (project_path / mention_path).resolve()

    # Ensure the normalized path is within project directory for security
    try:
        normalized.relative_to(project_path)
    except ValueError:
        # Path is outside project directory - return as-is for validation later
        pass

    return str(normalized)


def validate_mention(mention: FileMention, project_dir: str) -> tuple[bool, Optional[str]]:
    """
    Validate a file mention for security and existence.

    Args:
        mention: FileMention to validate
        project_dir: Project root directory

    Returns:
        Tuple of (is_valid, error_message)

    Security checks:
    - Path traversal prevention (../.. outside project)
    - File existence
    """
    project_path = Path(project_dir).resolve()
    normalized_path = Path(normalize_path(mention.file_path, project_dir))

    # Security: Check for path traversal
    try:
        normalized_path.relative_to(project_path)
    except ValueError:
        return False, f"Path outside project directory: @{mention.file_path}"

    # Check if file exists
    if not normalized_path.exists():
        return False, f"File not found: @{mention.file_path}"

    # Check if it's a file (not directory)
    if not normalized_path.is_file():
        return False, f"Not a file: @{mention.file_path}"

    return True, None


def extract_mentions_safe(
    text: str, project_dir: str, validate: bool = True
) -> tuple[List[FileMention], List[tuple[FileMention, str]]]:
    """
    Extract and optionally validate file mentions from text.

    Args:
        text: User message text to parse
        project_dir: Project root directory
        validate: Whether to validate file existence and security

    Returns:
        Tuple of (valid_mentions, invalid_mentions)
        - valid_mentions: List of validated FileMention objects
        - invalid_mentions: List of (mention, error_message) tuples

    Examples:
        >>> valid, invalid = extract_mentions_safe("See @src/App.tsx and @missing.js", "/project")
        >>> len(valid)
        1
        >>> len(invalid)
        1
    """
    mentions = parse_mentions(text)
    valid_mentions = []
    invalid_mentions = []

    for mention in mentions:
        if validate:
            is_valid, error = validate_mention(mention, project_dir)
            if is_valid:
                valid_mentions.append(mention)
            else:
                invalid_mentions.append((mention, error))
        else:
            valid_mentions.append(mention)

    return valid_mentions, invalid_mentions


def deduplicate_mentions(mentions: List[FileMention]) -> List[FileMention]:
    """
    Remove duplicate file mentions, keeping first occurrence.

    Args:
        mentions: List of FileMention objects

    Returns:
        List with duplicates removed

    Examples:
        >>> mentions = parse_mentions("@file.js and @file.js")
        >>> deduplicate_mentions(mentions)
        [FileMention(file_path='file.js')]
    """
    seen = set()
    unique_mentions = []

    for mention in mentions:
        # Create a unique key based on path and line range
        key = (mention.file_path, mention.line_start, mention.line_end)
        if key not in seen:
            seen.add(key)
            unique_mentions.append(mention)

    return unique_mentions
