#!/usr/bin/env python3
"""
File Reader Module - Read files with encoding detection and line range support

This module provides functionality to read files safely with:
- Automatic encoding detection (chardet)
- Line range support (1-based user-facing, 0-based internal)
- Binary file detection
- Error handling
- File metadata extraction
- Smart truncation for large files

Examples:
    >>> read_file_with_context("src/App.tsx")
    FileContext(content="...", line_count=45, file_size=1234, encoding="utf-8")

    >>> read_file_with_context("README.md", line_start=10, line_end=20)
    FileContext(content="lines 10-20", line_count=11, file_size=5678, encoding="utf-8")
"""

import itertools
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Binary file extensions to skip
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
    ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".mp3", ".mp4", ".avi", ".mov", ".wav",
    ".ttf", ".otf", ".woff", ".woff2",
    ".class", ".jar", ".war",
}


@dataclass
class FileContext:
    """Contains file content and metadata."""

    content: str  # File content (possibly truncated)
    line_count: int  # Total lines in file
    file_size: int  # File size in bytes
    encoding: str  # Detected encoding
    truncated: bool = False  # Whether content was truncated
    lines_included: int = 0  # Number of lines included in content


class FileReadError(Exception):
    """Custom exception for file read errors."""

    def __init__(self, message: str, file_path: str, reason: str = ""):
        self.message = message
        self.file_path = file_path
        self.reason = reason
        super().__init__(self.message)


def is_binary_file(file_path: str) -> bool:
    """
    Check if file is likely binary based on extension.

    Args:
        file_path: Path to the file

    Returns:
        True if file has binary extension
    """
    return Path(file_path).suffix.lower() in BINARY_EXTENSIONS


def detect_encoding(file_path: str) -> tuple[str, float]:
    """
    Detect file encoding using chardet.

    Args:
        file_path: Path to the file

    Returns:
        Tuple of (encoding_name, confidence_score)

    Raises:
        FileReadError: If file cannot be read for encoding detection
    """
    try:
        import chardet

        # Read first 10KB for encoding detection
        with open(file_path, "rb") as f:
            raw_data = f.read(10240)

        if not raw_data:
            # Empty file - default to utf-8
            return "utf-8", 1.0

        result = chardet.detect(raw_data)
        encoding = result.get("encoding", "utf-8")
        confidence = result.get("confidence", 0.0)

        # Fallback to utf-8 if detection fails
        if not encoding or confidence < 0.5:
            encoding = "utf-8"

        return encoding, confidence

    except FileNotFoundError:
        raise FileReadError(
            f"File not found: {file_path}", file_path, "File does not exist"
        )
    except PermissionError:
        raise FileReadError(
            f"Permission denied: {file_path}", file_path, "Insufficient permissions"
        )
    except Exception as e:
        raise FileReadError(
            f"Failed to detect encoding: {file_path}",
            file_path,
            str(e),
        )


def read_file_lines(
    file_path: str,
    encoding: str = "utf-8",
    line_start: Optional[int] = None,
    line_end: Optional[int] = None,
) -> list[str]:
    """
    Read file lines with optional line range.

    Line numbers are 1-based (user-facing), converted to 0-based internally for itertools.islice.

    Args:
        file_path: Path to the file
        encoding: File encoding (default: utf-8)
        line_start: Start line number (1-based, inclusive, optional)
        line_end: End line number (1-based, inclusive, optional)

    Returns:
        List of lines from the file

    Raises:
        FileReadError: If file cannot be read
    """
    try:
        with open(file_path, "r", encoding=encoding, errors="replace") as f:
            # Handle line ranges
            # User-facing line numbers are 1-based, but itertools.islice uses 0-based indexing
            # Example: user wants line 10 → islice(f, 9, 10)
            # Example: user wants lines 10-20 → islice(f, 9, 20)
            # Example: user wants lines 10- (open range) → islice(f, 9, None)
            if line_start is not None:
                # Convert 1-based to 0-based for start
                start_index = line_start - 1

                if line_end is not None and line_end >= line_start:
                    # Range: line_start to line_end (inclusive)
                    # islice stops before end_index, so we use line_end (not line_end - 1)
                    # Example: lines 10-20 → islice(f, 9, 20) gives us lines 10-20
                    end_index = line_end
                    lines = list(itertools.islice(f, start_index, end_index))
                elif line_end is None:
                    # Open range: from line_start to end of file
                    # Example: line 10- → islice(f, 9, None) gives us from line 10 to end
                    lines = list(itertools.islice(f, start_index, None))
                else:
                    # Single line (when line_end < line_start, treat as single line)
                    lines = list(itertools.islice(f, start_index, line_start))
            else:
                # Read entire file
                lines = f.readlines()

        return lines

    except FileNotFoundError:
        raise FileReadError(
            f"File not found: {file_path}", file_path, "File does not exist"
        )
    except PermissionError:
        raise FileReadError(
            f"Permission denied: {file_path}", file_path, "Insufficient permissions"
        )
    except UnicodeDecodeError as e:
        raise FileReadError(
            f"Encoding error: {file_path}",
            file_path,
            f"Failed to decode with {encoding}: {e}",
        )
    except Exception as e:
        raise FileReadError(
            f"Failed to read file: {file_path}",
            file_path,
            str(e),
        )


def truncate_large_file(
    lines: list[str],
    max_lines: int = 1000,
    keep_end: int = 100,
) -> tuple[list[str], bool]:
    """
    Truncate large files to first N lines and last M lines.

    Strategy: Show first max_lines lines + truncation marker + last keep_end lines.

    Args:
        lines: All lines from the file
        max_lines: Maximum lines to show from the start
        keep_end: Number of lines to keep from the end

    Returns:
        Tuple of (truncated_lines, was_truncated)
    """
    if len(lines) <= max_lines:
        return lines, False

    # Take first max_lines and last keep_end lines
    first_part = lines[:max_lines]
    last_part = lines[-keep_end:] if keep_end > 0 else []

    # Insert truncation marker
    truncated_lines = first_part + [f"\n[... {len(lines) - max_lines - keep_end} lines truncated ...]\n"] + last_part

    return truncated_lines, True


def read_file_with_context(
    file_path: str,
    line_start: Optional[int] = None,
    line_end: Optional[int] = None,
    max_lines: int = 1000,
    keep_end: int = 100,
) -> FileContext:
    """
    Read file with encoding detection, line range support, and smart truncation.

    Args:
        file_path: Path to the file (relative or absolute)
        line_start: Start line number (1-based, inclusive, optional)
        line_end: End line number (1-based, inclusive, optional)
        max_lines: Maximum lines to show before truncation (default: 1000)
        keep_end: Number of lines to keep from end when truncating (default: 100)

    Returns:
        FileContext object with content and metadata

    Raises:
        FileReadError: If file cannot be read or is binary

    Examples:
        >>> ctx = read_file_with_context("src/App.tsx")
        >>> ctx.line_count
        45

        >>> ctx = read_file_with_context("README.md", line_start=10, line_end=20)
        >>> ctx.lines_included
        11
    """
    # Check for binary file
    if is_binary_file(file_path):
        raise FileReadError(
            f"Binary file not supported: {file_path}",
            file_path,
            "Binary files cannot be displayed",
        )

    # Check file exists and get file size
    path = Path(file_path)
    if not path.exists():
        raise FileReadError(
            f"File not found: {file_path}",
            file_path,
            "File does not exist",
        )

    try:
        file_size = path.stat().st_size
    except Exception as e:
        raise FileReadError(
            f"Cannot access file: {file_path}",
            file_path,
            str(e),
        )

    # Detect encoding
    encoding, confidence = detect_encoding(file_path)

    # Read file with line range
    lines = read_file_lines(file_path, encoding, line_start, line_end)
    total_lines = len(lines)

    # Apply truncation if needed (only when not reading a specific line range)
    if line_start is None and line_end is None and total_lines > max_lines:
        lines, truncated = truncate_large_file(lines, max_lines, keep_end)
    else:
        truncated = False

    # Join lines into content
    content = "".join(lines)

    return FileContext(
        content=content,
        line_count=total_lines,
        file_size=file_size,
        encoding=encoding,
        truncated=truncated,
        lines_included=len(lines),
    )


def read_file_safe(
    file_path: str,
    line_start: Optional[int] = None,
    line_end: Optional[int] = None,
    max_lines: int = 1000,
    keep_end: int = 100,
) -> tuple[Optional[FileContext], Optional[str]]:
    """
    Safely read file, returning context or error message.

    Args:
        file_path: Path to the file
        line_start: Start line number (1-based, inclusive, optional)
        line_end: End line number (1-based, inclusive, optional)
        max_lines: Maximum lines to show before truncation
        keep_end: Number of lines to keep from end when truncating

    Returns:
        Tuple of (file_context, error_message)
        - If successful: (FileContext, None)
        - If failed: (None, error_message)
    """
    try:
        context = read_file_with_context(
            file_path, line_start, line_end, max_lines, keep_end
        )
        return context, None
    except FileReadError as e:
        return None, str(e)
    except Exception as e:
        return None, f"Unexpected error reading {file_path}: {e}"
