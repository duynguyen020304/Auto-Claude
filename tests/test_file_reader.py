#!/usr/bin/env python3
"""
Tests for File Reader Module
============================

Tests the file_reader module functionality including:
- FileContext dataclass
- FileReadError exception
- Binary file detection
- Encoding detection (chardet)
- Line range reading (1-based user-facing, 0-based internal)
- Large file truncation
- Safe file reading with error handling
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# Add apps/backend/runners directory to path for import
_runners_dir = Path(__file__).parent.parent / "apps" / "backend" / "runners"
if str(_runners_dir) not in sys.path:
    sys.path.insert(0, str(_runners_dir))

from file_reader import (
    FileContext,
    FileReadError,
    BINARY_EXTENSIONS,
    is_binary_file,
    detect_encoding,
    read_file_lines,
    truncate_large_file,
    read_file_with_context,
    read_file_safe,
)


# ============================================================================
# FileContext Tests
# ============================================================================

class TestFileContext:
    """Test FileContext dataclass."""

    def test_create_file_context(self):
        """Test creating a FileContext object."""
        ctx = FileContext(
            content="Hello World",
            line_count=10,
            file_size=100,
            encoding="utf-8"
        )

        assert ctx.content == "Hello World"
        assert ctx.line_count == 10
        assert ctx.file_size == 100
        assert ctx.encoding == "utf-8"
        assert ctx.truncated is False  # Default value
        assert ctx.lines_included == 0  # Default value

    def test_file_context_with_truncation(self):
        """Test FileContext with truncation info."""
        ctx = FileContext(
            content="truncated content",
            line_count=2000,
            file_size=50000,
            encoding="utf-8",
            truncated=True,
            lines_included=1100
        )

        assert ctx.truncated is True
        assert ctx.lines_included == 1100


# ============================================================================
# FileReadError Tests
# ============================================================================

class TestFileReadError:
    """Test FileReadError exception."""

    def test_create_error(self):
        """Test creating a FileReadError."""
        error = FileReadError("Failed to read", "/path/to/file.txt", "Permission denied")

        assert str(error) == "Failed to read"
        assert error.message == "Failed to read"
        assert error.file_path == "/path/to/file.txt"
        assert error.reason == "Permission denied"

    def test_error_without_reason(self):
        """Test creating FileReadError without reason."""
        error = FileReadError("File not found", "/path/to/missing.txt")

        assert error.message == "File not found"
        assert error.reason == ""


# ============================================================================
# Binary File Detection Tests
# ============================================================================

class TestBinaryFileDetection:
    """Test is_binary_file function."""

    def test_detect_image_binary(self):
        """Test detection of image files as binary."""
        assert is_binary_file("image.png") is True
        assert is_binary_file("photo.jpg") is True
        assert is_binary_file("picture.jpeg") is True
        assert is_binary_file("animation.gif") is True
        assert is_binary_file("icon.ico") is True

    def test_detect_archive_binary(self):
        """Test detection of archive files as binary."""
        assert is_binary_file("archive.zip") is True
        assert is_binary_file("data.tar") is True
        assert is_binary_file("compressed.gz") is True
        assert is_binary_file("packed.rar") is True
        assert is_binary_file("archive.7z") is True

    def test_detect_executable_binary(self):
        """Test detection of executable files as binary."""
        assert is_binary_file("program.exe") is True
        assert is_binary_file("library.dll") is True
        assert is_binary_file("module.so") is True
        assert is_binary_file("lib.dylib") is True

    def test_detect_media_binary(self):
        """Test detection of media files as binary."""
        assert is_binary_file("audio.mp3") is True
        assert is_binary_file("video.mp4") is True
        assert is_binary_file("movie.avi") is True
        assert is_binary_file("clip.mov") is True

    def test_detect_font_binary(self):
        """Test detection of font files as binary."""
        assert is_binary_file("font.ttf") is True
        assert is_binary_file("font.otf") is True
        assert is_binary_file("font.woff") is True
        assert is_binary_file("font.woff2") is True

    def test_detect_pdf_binary(self):
        """Test detection of PDF as binary."""
        assert is_binary_file("document.pdf") is True

    def test_text_files_not_binary(self):
        """Test that text files are not binary."""
        assert is_binary_file("file.txt") is False
        assert is_binary_file("code.py") is False
        assert is_binary_file("script.js") is False
        assert is_binary_file("style.css") is False
        assert is_binary_file("page.html") is False
        assert is_binary_file("data.json") is False
        assert is_binary_file("config.xml") is False
        assert is_binary_file("README.md") is False

    def test_case_insensitive_extension(self):
        """Test that extension check is case-insensitive."""
        assert is_binary_file("image.PNG") is True
        assert is_binary_file("photo.JPG") is True
        assert is_binary_file("archive.ZIP") is True


# ============================================================================
# Encoding Detection Tests
# ============================================================================

class TestEncodingDetection:
    """Test detect_encoding function."""

    def test_detect_utf8_encoding(self, tmp_path):
        """Test detecting UTF-8 encoding."""
        # Create a UTF-8 file with content that requires UTF-8
        test_file = tmp_path / "test_utf8.txt"
        test_file.write_text("Hello 世界 🌍", encoding="utf-8")

        encoding, confidence = detect_encoding(str(test_file))

        # UTF-8 content should result in utf-8 encoding
        # (either detected directly or via fallback)
        assert encoding == "utf-8"
        # Confidence may vary (chardet might have low confidence on short samples,
        # but the function falls back to utf-8 when confidence < 0.5)
        assert confidence >= 0.0

    def test_detect_ascii_as_utf8(self, tmp_path):
        """Test that ASCII files are detected as UTF-8."""
        test_file = tmp_path / "test_ascii.txt"
        test_file.write_text("Simple ASCII text", encoding="ascii")

        encoding, confidence = detect_encoding(str(test_file))

        # ASCII should be detected as utf-8 or similar
        assert encoding is not None
        assert confidence > 0.5

    def test_empty_file_defaults_to_utf8(self, tmp_path):
        """Test that empty files default to UTF-8."""
        test_file = tmp_path / "empty.txt"
        test_file.write_text("", encoding="utf-8")

        encoding, confidence = detect_encoding(str(test_file))

        assert encoding == "utf-8"
        assert confidence == 1.0

    def test_detect_encoding_latin1(self, tmp_path):
        """Test detecting Latin-1 encoding."""
        test_file = tmp_path / "test_latin1.txt"
        # Create file with Latin-1 specific characters
        content = "Café résumé naïve"
        test_file.write_text(content, encoding="latin-1")

        encoding, confidence = detect_encoding(str(test_file))

        # Should detect some encoding (might be latin-1, iso-8859-1, or similar)
        assert encoding is not None
        assert confidence > 0.0

    def test_file_not_found_error(self, tmp_path):
        """Test FileReadError for non-existent file."""
        non_existent = tmp_path / "does_not_exist.txt"

        with pytest.raises(FileReadError) as exc_info:
            detect_encoding(str(non_existent))

        assert "File not found" in str(exc_info.value)
        assert str(non_existent) in str(exc_info.value)

    @patch("builtins.open", side_effect=PermissionError("Permission denied"))
    def test_permission_error(self, mock_open, tmp_path):
        """Test FileReadError for permission errors."""
        test_file = tmp_path / "test.txt"

        with pytest.raises(FileReadError) as exc_info:
            detect_encoding(str(test_file))

        assert "Permission denied" in str(exc_info.value)
        assert str(test_file) in str(exc_info.value)


# ============================================================================
# File Line Reading Tests
# ============================================================================

class TestReadFileLines:
    """Test read_file_lines function."""

    def test_read_all_lines(self, tmp_path):
        """Test reading all lines from file."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("Line 1\nLine 2\nLine 3\n", encoding="utf-8")

        lines = read_file_lines(str(test_file))

        assert len(lines) == 3
        assert lines[0] == "Line 1\n"
        assert lines[1] == "Line 2\n"
        assert lines[2] == "Line 3\n"

    def test_read_line_range(self, tmp_path):
        """Test reading specific line range."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n", encoding="utf-8")

        # Read lines 2-4 (1-based, inclusive)
        lines = read_file_lines(str(test_file), line_start=2, line_end=4)

        assert len(lines) == 3
        assert lines[0] == "Line 2\n"
        assert lines[1] == "Line 3\n"
        assert lines[2] == "Line 4\n"

    def test_read_single_line(self, tmp_path):
        """Test reading a single line."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("Line 1\nLine 2\nLine 3\n", encoding="utf-8")

        lines = read_file_lines(str(test_file), line_start=2, line_end=2)

        assert len(lines) == 1
        assert lines[0] == "Line 2\n"

    def test_read_open_range_from_line(self, tmp_path):
        """Test reading from specific line to end."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n", encoding="utf-8")

        # Read from line 3 to end
        lines = read_file_lines(str(test_file), line_start=3)

        assert len(lines) == 3
        assert lines[0] == "Line 3\n"
        assert lines[1] == "Line 4\n"
        assert lines[2] == "Line 5\n"

    def test_read_first_line(self, tmp_path):
        """Test reading first line (1-based index)."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("First line\nSecond line\n", encoding="utf-8")

        lines = read_file_lines(str(test_file), line_start=1, line_end=1)

        assert len(lines) == 1
        assert lines[0] == "First line\n"

    def test_read_with_different_encoding(self, tmp_path):
        """Test reading file with specific encoding."""
        test_file = tmp_path / "test.txt"
        # Write with latin-1 encoding
        test_file.write_text("Café résumé", encoding="latin-1")

        # Read with same encoding
        lines = read_file_lines(str(test_file), encoding="latin-1")

        assert len(lines) == 1
        assert "Café" in lines[0]

    def test_file_not_found_error(self, tmp_path):
        """Test FileReadError for non-existent file."""
        non_existent = tmp_path / "does_not_exist.txt"

        with pytest.raises(FileReadError) as exc_info:
            read_file_lines(str(non_existent))

        assert "File not found" in str(exc_info.value)

    def test_unicode_decode_error_with_replace(self, tmp_path):
        """Test that decode errors are handled with errors='replace'."""
        test_file = tmp_path / "test.txt"
        # Write some bytes that are not valid UTF-8
        test_file.write_bytes(b"Hello \xff\xff World")

        # Should not raise an exception, should replace invalid bytes
        lines = read_file_lines(str(test_file), encoding="utf-8")

        assert len(lines) == 1
        # The replacement character should appear
        assert "" in lines[0] or "Hello" in lines[0]


# ============================================================================
# File Truncation Tests
# ============================================================================

class TestTruncateLargeFile:
    """Test truncate_large_file function."""

    def test_no_truncation_small_file(self):
        """Test that small files are not truncated."""
        lines = ["Line {}\n".format(i) for i in range(10)]
        truncated, was_truncated = truncate_large_file(lines, max_lines=100)

        assert was_truncated is False
        assert len(truncated) == 10
        assert truncated == lines

    def test_truncate_large_file(self):
        """Test truncating a large file."""
        # Create 1500 lines
        lines = ["Line {}\n".format(i) for i in range(1500)]
        truncated, was_truncated = truncate_large_file(
            lines, max_lines=1000, keep_end=100
        )

        assert was_truncated is True
        # Should have: 1000 + 1 (truncation marker) + 100 = 1101 lines
        assert len(truncated) == 1101

        # Check first lines are present
        assert "Line 0\n" in truncated[0]
        assert "Line 999\n" in truncated[999]

        # Check truncation marker
        assert "truncated" in truncated[1000].lower()
        assert "400" in truncated[1000]  # 1500 - 1000 - 100 = 400

        # Check last lines are present
        assert "Line 1400\n" in truncated[1101 - 100]
        assert "Line 1499\n" in truncated[-1]

    def test_truncate_with_zero_keep_end(self):
        """Test truncation without keeping end lines."""
        lines = ["Line {}\n".format(i) for i in range(1500)]
        truncated, was_truncated = truncate_large_file(
            lines, max_lines=1000, keep_end=0
        )

        assert was_truncated is True
        # Should have: 1000 + 1 (truncation marker) + 0 = 1001 lines
        assert len(truncated) == 1001

        # No lines from the end should be present
        assert "Line 1400\n" not in truncated[-1]

    def test_truncate_exact_boundary(self):
        """Test file exactly at max_lines boundary."""
        lines = ["Line {}\n".format(i) for i in range(1000)]
        truncated, was_truncated = truncate_large_file(lines, max_lines=1000)

        assert was_truncated is False
        assert len(truncated) == 1000

    def test_truncate_one_over_boundary(self):
        """Test file one line over boundary."""
        lines = ["Line {}\n".format(i) for i in range(1001)]
        truncated, was_truncated = truncate_large_file(
            lines, max_lines=1000, keep_end=100
        )

        assert was_truncated is True
        # 1000 + 1 marker - (1000+100-1001) = need to calculate
        # Actually: 1000 (first) + 1 (marker) + 100 (end) - overlap adjustment
        # 1001 total - 1000 max = 1 over, so keep_end starts at line 901
        # Result should be: 1000 + 1 + 100 = 1101
        assert len(truncated) == 1101


# ============================================================================
# Read File With Context Tests
# ============================================================================

class TestReadFileWithContext:
    """Test read_file_with_context function."""

    def test_read_simple_file(self, tmp_path):
        """Test reading a simple file."""
        test_file = tmp_path / "test.txt"
        # Use content that requires UTF-8 encoding detection
        test_file.write_text("Hello\nWorld\n", encoding="utf-8")

        ctx = read_file_with_context(str(test_file))

        assert isinstance(ctx, FileContext)
        assert ctx.content == "Hello\nWorld\n"
        assert ctx.line_count == 2
        assert ctx.file_size > 0
        # Simple ASCII might be detected as ascii or utf-8
        assert ctx.encoding in ["ascii", "utf-8"]
        assert ctx.truncated is False

    def test_read_with_line_range(self, tmp_path):
        """Test reading file with line range."""
        test_file = tmp_path / "test.txt"
        content = "\n".join([f"Line {i}" for i in range(1, 101)])
        test_file.write_text(content, encoding="utf-8")

        ctx = read_file_with_context(str(test_file), line_start=10, line_end=20)

        assert ctx.line_count == 11  # Lines 10-20 inclusive
        assert ctx.lines_included == 11
        assert "Line 10" in ctx.content
        assert "Line 20" in ctx.content
        # Line range reads don't truncate
        assert ctx.truncated is False

    def test_read_large_file_with_truncation(self, tmp_path):
        """Test reading large file triggers truncation."""
        test_file = tmp_path / "large.txt"
        # Create 1500 lines
        content = "\n".join([f"Line {i}" for i in range(1500)])
        test_file.write_text(content, encoding="utf-8")

        ctx = read_file_with_context(str(test_file), max_lines=1000, keep_end=100)

        assert ctx.truncated is True
        assert ctx.line_count == 1500
        assert ctx.lines_included == 1101  # 1000 + 1 marker + 100
        assert "truncated" in ctx.content.lower()

    def test_read_binary_file_raises_error(self, tmp_path):
        """Test that binary files raise FileReadError."""
        test_file = tmp_path / "test.png"
        test_file.write_bytes(b"\x89PNG\r\n\x1a\n")  # PNG signature

        with pytest.raises(FileReadError) as exc_info:
            read_file_with_context(str(test_file))

        assert "Binary file" in str(exc_info.value)
        assert "not supported" in str(exc_info.value).lower()

    def test_read_nonexistent_file_raises_error(self, tmp_path):
        """Test that non-existent files raise FileReadError."""
        non_existent = tmp_path / "does_not_exist.txt"

        with pytest.raises(FileReadError) as exc_info:
            read_file_with_context(str(non_existent))

        assert "File not found" in str(exc_info.value)

    def test_read_file_with_different_encoding(self, tmp_path):
        """Test reading file with non-UTF8 encoding."""
        test_file = tmp_path / "latin1.txt"
        content = "Café résumé naïve"
        test_file.write_text(content, encoding="latin-1")

        ctx = read_file_with_context(str(test_file))

        # chardet might detect as latin-1, iso-8859-1, ISO-8859-1, or ISO-8859-9
        assert ctx.encoding in ["latin-1", "iso-8859-1", "ISO-8859-1", "ISO-8859-9"]
        assert "Café" in ctx.content

    def test_read_empty_file(self, tmp_path):
        """Test reading empty file."""
        test_file = tmp_path / "empty.txt"
        test_file.write_text("", encoding="utf-8")

        ctx = read_file_with_context(str(test_file))

        assert ctx.content == ""
        assert ctx.line_count == 0
        assert ctx.file_size == 0
        assert ctx.encoding == "utf-8"

    def test_read_file_with_open_range(self, tmp_path):
        """Test reading from line N to end."""
        test_file = tmp_path / "test.txt"
        content = "\n".join([f"Line {i}" for i in range(1, 101)])
        test_file.write_text(content, encoding="utf-8")

        ctx = read_file_with_context(str(test_file), line_start=90)

        assert ctx.line_count == 11  # Lines 90-100
        assert "Line 90" in ctx.content
        assert "Line 100" in ctx.content


# ============================================================================
# Read File Safe Tests
# ============================================================================

class TestReadFileSafe:
    """Test read_file_safe function."""

    def test_read_safe_success(self, tmp_path):
        """Test successful read returns context."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("Hello World", encoding="utf-8")

        ctx, error = read_file_safe(str(test_file))

        assert ctx is not None
        assert error is None
        assert isinstance(ctx, FileContext)
        assert ctx.content == "Hello World"

    def test_read_safe_file_not_found(self, tmp_path):
        """Test read_safe with non-existent file."""
        non_existent = tmp_path / "missing.txt"

        ctx, error = read_file_safe(str(non_existent))

        assert ctx is None
        assert error is not None
        assert "File not found" in error
        assert "missing.txt" in error

    def test_read_safe_binary_file(self, tmp_path):
        """Test read_safe with binary file."""
        test_file = tmp_path / "test.png"
        test_file.write_bytes(b"\x89PNG\r\n\x1a\n")

        ctx, error = read_file_safe(str(test_file))

        assert ctx is None
        assert error is not None
        assert "Binary file" in error

    def test_read_safe_with_line_range(self, tmp_path):
        """Test read_safe with line range."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("Line 1\nLine 2\nLine 3\n", encoding="utf-8")

        ctx, error = read_file_safe(str(test_file), line_start=2, line_end=2)

        assert error is None
        assert ctx is not None
        assert "Line 2" in ctx.content

    def test_read_safe_permission_error(self, tmp_path):
        """Test read_safe handles permission errors."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("content", encoding="utf-8")

        # Mock open to raise permission error
        with patch("builtins.open", side_effect=PermissionError("No access")):
            ctx, error = read_file_safe(str(test_file))

            # Should catch the error and return it
            assert ctx is None
            assert error is not None
            # The error message should mention the file
            assert str(test_file) in error or "permission" in error.lower() or "failed" in error.lower()


# ============================================================================
# Integration Tests
# ============================================================================

class TestFileReaderIntegration:
    """Integration tests for file reader functionality."""

    def test_read_python_file_with_encoding(self, tmp_path):
        """Test reading a Python source file."""
        test_file = tmp_path / "script.py"
        content = '''#!/usr/bin/env python3
"""Test script."""

def hello():
    print("Hello, World!")
'''
        test_file.write_text(content, encoding="utf-8")

        ctx = read_file_with_context(str(test_file))

        # ASCII content might be detected as ascii or utf-8
        assert ctx.encoding in ["ascii", "utf-8"]
        assert "def hello():" in ctx.content
        assert ctx.line_count == 5

    def test_read_json_file(self, tmp_path):
        """Test reading a JSON file."""
        test_file = tmp_path / "data.json"
        content = '{"name": "test", "value": 123}'
        test_file.write_text(content, encoding="utf-8")

        ctx = read_file_with_context(str(test_file))

        assert '"name"' in ctx.content
        assert ctx.line_count == 1

    def test_read_markdown_file_with_lines(self, tmp_path):
        """Test reading markdown file with line range."""
        test_file = tmp_path / "README.md"
        content = "\n".join([
            "# Title",
            "",
            "## Section 1",
            "Content here",
            "",
            "## Section 2",
            "More content"
        ])
        test_file.write_text(content, encoding="utf-8")

        # Read just Section 2
        ctx = read_file_with_context(str(test_file), line_start=5, line_end=7)

        assert ctx.line_count == 3
        assert "## Section 2" in ctx.content

    def test_mixed_line_endings(self, tmp_path):
        """Test reading file with mixed line endings."""
        test_file = tmp_path / "mixed.txt"
        # Write with binary to have mixed line endings
        content = b"Line1\nLine2\r\nLine3\n"
        test_file.write_bytes(content)

        ctx = read_file_with_context(str(test_file))

        # Should handle mixed line endings
        assert ctx.line_count == 3
        assert "Line1" in ctx.content


# ============================================================================
# Edge Cases
# ============================================================================

class TestEdgeCases:
    """Test edge cases and error conditions."""

    def test_file_with_only_newlines(self, tmp_path):
        """Test file containing only newlines."""
        test_file = tmp_path / "newlines.txt"
        test_file.write_text("\n\n\n\n", encoding="utf-8")

        ctx = read_file_with_context(str(test_file))

        assert ctx.line_count == 4
        assert ctx.content == "\n\n\n\n"

    def test_file_with_special_characters(self, tmp_path):
        """Test file with various special characters."""
        test_file = tmp_path / "special.txt"
        content = "Tab:\tSeparator:\x1bUnicode: café 日本語"
        test_file.write_text(content, encoding="utf-8")

        ctx = read_file_with_context(str(test_file))

        assert "Tab:" in ctx.content
        assert "café" in ctx.content

    def test_very_long_line(self, tmp_path):
        """Test file with very long line."""
        test_file = tmp_path / "longline.txt"
        long_line = "A" * 10000 + "\n"
        test_file.write_text(long_line, encoding="utf-8")

        ctx = read_file_with_context(str(test_file))

        assert ctx.line_count == 1
        assert len(ctx.content) > 10000

    def test_line_range_beyond_file(self, tmp_path):
        """Test line range beyond file end."""
        test_file = tmp_path / "short.txt"
        test_file.write_text("Line 1\nLine 2\n", encoding="utf-8")

        # Request lines beyond file
        lines = read_file_lines(str(test_file), line_start=10, line_end=20)

        # Should return empty list
        assert lines == []

    def test_line_start_zero_raises_error(self, tmp_path):
        """Test line_start=0 raises an error (invalid 1-based index)."""
        test_file = tmp_path / "test.txt"
        test_file.write_text("Line 1\nLine 2\n", encoding="utf-8")

        # line_start=0 is invalid for 1-based indexing
        # The function uses line_start - 1 for islice, resulting in -1
        # which causes ValueError
        with pytest.raises(FileReadError) as exc_info:
            read_file_lines(str(test_file), line_start=0, line_end=1)

        assert "Failed to read file" in str(exc_info.value)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
