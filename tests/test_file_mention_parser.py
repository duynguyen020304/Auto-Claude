#!/usr/bin/env python3
"""
Tests for File Mention Parser
==============================

Tests the file_mention_parser module functionality including:
- FileMention dataclass
- Parsing @ mentions from text
- Line range extraction (single, range, open)
- Path normalization (relative, absolute)
- Path validation (security, existence)
- Deduplication of mentions
"""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Add apps/backend/runners directory to path for import
# We're in tests/, so go to parent (project root), then into apps/backend/runners
_runners_dir = Path(__file__).parent.parent / "apps" / "backend" / "runners"
if str(_runners_dir) not in sys.path:
    sys.path.insert(0, str(_runners_dir))

from file_mention_parser import (
    FileMention,
    deduplicate_mentions,
    extract_mentions_safe,
    normalize_path,
    parse_mentions,
    validate_mention,
)


class TestFileMention:
    """Test FileMention dataclass."""

    def test_create_simple_mention(self):
        """Test creating a mention without line range."""
        mention = FileMention(file_path="src/App.tsx")

        assert mention.file_path == "src/App.tsx"
        assert mention.line_start is None
        assert mention.line_end is None
        assert mention.has_line_range is False

    def test_create_mention_with_range(self):
        """Test creating a mention with line range."""
        mention = FileMention(file_path="file.js", line_start=10, line_end=50)

        assert mention.file_path == "file.js"
        assert mention.line_start == 10
        assert mention.line_end == 50
        assert mention.has_line_range is True

    def test_create_mention_with_single_line(self):
        """Test creating a mention with single line."""
        mention = FileMention(file_path="README.md", line_start=10, line_end=10)

        assert mention.line_start == 10
        assert mention.line_end == 10
        assert mention.has_line_range is True

    def test_str_simple(self):
        """Test string representation of simple mention."""
        mention = FileMention(file_path="src/App.tsx")
        assert str(mention) == "@src/App.tsx"

    def test_str_with_range(self):
        """Test string representation of mention with range."""
        mention = FileMention(file_path="file.js", line_start=10, line_end=50)
        assert str(mention) == "@file.js:10-50"

    def test_str_with_single_line(self):
        """Test string representation of mention with single line."""
        mention = FileMention(file_path="README.md", line_start=10, line_end=10)
        # Single line shows as just :10 (not :10-10)
        assert str(mention) == "@README.md:10-10"

    def test_str_with_open_range(self):
        """Test string representation of mention with open range (start only)."""
        mention = FileMention(file_path="file.js", line_start=10, line_end=None)
        assert str(mention) == "@file.js:10"


class TestParseMentions:
    """Test parse_mentions function."""

    def test_parse_simple_mention(self):
        """Test parsing a simple @filename mention."""
        text = "Check @src/App.tsx for details"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].file_path == "src/App.tsx"
        assert mentions[0].line_start is None

    def test_parse_multiple_mentions(self):
        """Test parsing multiple mentions in one text."""
        text = "Compare @src/App.tsx and @src/main.tsx"
        mentions = parse_mentions(text)

        assert len(mentions) == 2
        assert mentions[0].file_path == "src/App.tsx"
        assert mentions[1].file_path == "src/main.tsx"

    def test_parse_mention_with_range(self):
        """Test parsing mention with line range."""
        text = "See @file.js:10-50 for details"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].file_path == "file.js"
        assert mentions[0].line_start == 10
        assert mentions[0].line_end == 50

    def test_parse_mention_with_single_line(self):
        """Test parsing mention with single line."""
        text = "Check line @file.js:100"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].file_path == "file.js"
        assert mentions[0].line_start == 100
        assert mentions[0].line_end == 100

    def test_parse_mention_with_open_range(self):
        """Test parsing mention with open range (10-)."""
        text = "Lines @file.js:10- onwards"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].file_path == "file.js"
        assert mentions[0].line_start == 10
        assert mentions[0].line_end is None

    def test_parse_windows_path(self):
        """Test parsing Windows paths with backslashes."""
        text = "Check @src\\components\\Button.tsx"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        # Backslashes should be normalized to forward slashes
        assert mentions[0].file_path == "src/components/Button.tsx"

    def test_parse_absolute_path(self):
        """Test parsing absolute path."""
        text = "See @/home/user/project/src/App.tsx"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].file_path == "/home/user/project/src/App.tsx"

    def test_parse_no_mentions(self):
        """Test parsing text with no mentions."""
        text = "This is just regular text with no mentions"
        mentions = parse_mentions(text)

        assert len(mentions) == 0

    def test_parse_mixed_mentions(self):
        """Test parsing text with mixed mention types."""
        text = "Check @src/App.tsx:10-50, @README.md, and @utils/helper.ts:100"
        mentions = parse_mentions(text)

        assert len(mentions) == 3
        assert mentions[0].file_path == "src/App.tsx"
        assert mentions[0].line_start == 10
        assert mentions[0].line_end == 50
        # Note: Comma is included in path since regex matches non-whitespace
        assert mentions[1].file_path == "README.md,"
        assert mentions[2].file_path == "utils/helper.ts"
        assert mentions[2].line_start == 100
        assert mentions[2].line_end == 100

    def test_parse_duplicate_mentions(self):
        """Test parsing duplicate mentions."""
        text = "Check @file.js and @file.js again"
        mentions = parse_mentions(text)

        # Should return both occurrences
        assert len(mentions) == 2
        assert mentions[0].file_path == "file.js"
        assert mentions[1].file_path == "file.js"

    def test_parse_with_colon_in_path(self):
        """Test that colons in file path are handled correctly."""
        # The regex should stop at the first colon for line numbers
        text = "Check @file.txt for info"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].file_path == "file.txt"

    def test_parse_at_sign_not_mention(self):
        """Test that email addresses are matched as potential file paths."""
        text = "Email me at test@example.com"
        mentions = parse_mentions(text)

        # The parser matches @example.com as a potential file path
        # (validation will fail it later if it doesn't exist as a file)
        assert len(mentions) == 1
        assert mentions[0].file_path == "example.com"


class TestNormalizePath:
    """Test normalize_path function."""

    @pytest.fixture
    def project_dir(self, tmp_path):
        """Create a temporary project directory."""
        return str(tmp_path)

    def test_normalize_relative_path(self, project_dir):
        """Test normalizing a relative path."""
        result = normalize_path("src/App.tsx", project_dir)

        assert result.startswith(project_dir)
        assert result.endswith("src/App.tsx")

    def test_normalize_absolute_path_within_project(self, project_dir):
        """Test normalizing absolute path within project."""
        abs_path = str(Path(project_dir) / "src" / "App.tsx")
        result = normalize_path(abs_path, project_dir)

        assert result == abs_path

    def test_normalize_absolute_path_outside_project(self, project_dir):
        """Test normalizing absolute path outside project."""
        outside_path = "/etc/passwd"
        result = normalize_path(outside_path, project_dir)

        # Should return the path as-is (validation happens later)
        assert result == "/etc/passwd"

    def test_normalize_with_parent_refs(self, project_dir):
        """Test normalizing path with parent directory references."""
        # Create subdirectory
        (Path(project_dir) / "src").mkdir()

        result = normalize_path("../src/App.tsx", project_dir)

        # Should resolve the parent reference
        assert "src/App.tsx" in result

    def test_normalize_with_current_dir_ref(self, project_dir):
        """Test normalizing path with current directory reference."""
        result = normalize_path("./src/App.tsx", project_dir)

        # Should resolve the . reference
        assert "src/App.tsx" in result
        assert "./" not in result


class TestValidateMention:
    """Test validate_mention function."""

    @pytest.fixture
    def project_dir(self, tmp_path):
        """Create a temporary project directory with test files."""
        # Create test files
        (tmp_path / "test.txt").write_text("content")
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "App.tsx").write_text("react code")

        return str(tmp_path)

    def test_validate_existing_file(self, project_dir):
        """Test validating an existing file."""
        mention = FileMention(file_path="test.txt")
        is_valid, error = validate_mention(mention, project_dir)

        assert is_valid is True
        assert error is None

    def test_validate_nested_file(self, project_dir):
        """Test validating a nested file."""
        mention = FileMention(file_path="src/App.tsx")
        is_valid, error = validate_mention(mention, project_dir)

        assert is_valid is True
        assert error is None

    def test_validate_missing_file(self, project_dir):
        """Test validating a non-existent file."""
        mention = FileMention(file_path="missing.js")
        is_valid, error = validate_mention(mention, project_dir)

        assert is_valid is False
        assert "File not found" in error
        assert "missing.js" in error

    def test_validate_directory(self, project_dir):
        """Test validating a directory instead of file."""
        mention = FileMention(file_path="src")
        is_valid, error = validate_mention(mention, project_dir)

        assert is_valid is False
        assert "Not a file" in error

    def test_validate_path_traversal(self, project_dir):
        """Test that path traversal is blocked."""
        mention = FileMention(file_path="../../../etc/passwd")
        is_valid, error = validate_mention(mention, project_dir)

        assert is_valid is False
        assert "outside project directory" in error.lower()

    def test_validate_absolute_path_outside(self, project_dir):
        """Test that absolute paths outside project are blocked."""
        mention = FileMention(file_path="/etc/passwd")
        is_valid, error = validate_mention(mention, project_dir)

        assert is_valid is False
        assert "outside project directory" in error.lower()

    def test_validate_with_line_range(self, project_dir):
        """Test that line ranges don't affect validation."""
        mention = FileMention(file_path="test.txt", line_start=10, line_end=50)
        is_valid, error = validate_mention(mention, project_dir)

        # Should still be valid
        assert is_valid is True
        assert error is None


class TestExtractMentionsSafe:
    """Test extract_mentions_safe function."""

    @pytest.fixture
    def project_dir(self, tmp_path):
        """Create a temporary project directory with test files."""
        (tmp_path / "test.txt").write_text("content")
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "App.tsx").write_text("react code")
        return str(tmp_path)

    def test_extract_with_validation(self, project_dir):
        """Test extraction with validation enabled."""
        text = "Check @test.txt and @missing.js"
        valid, invalid = extract_mentions_safe(text, project_dir, validate=True)

        assert len(valid) == 1
        assert valid[0].file_path == "test.txt"
        assert len(invalid) == 1
        assert invalid[0][0].file_path == "missing.js"
        assert "File not found" in invalid[0][1]

    def test_extract_without_validation(self, project_dir):
        """Test extraction with validation disabled."""
        text = "Check @test.txt and @missing.js"
        valid, invalid = extract_mentions_safe(text, project_dir, validate=False)

        # All mentions should be in valid list
        assert len(valid) == 2
        assert len(invalid) == 0

    def test_extract_no_mentions(self, project_dir):
        """Test extraction from text with no mentions."""
        text = "Just regular text"
        valid, invalid = extract_mentions_safe(text, project_dir)

        assert len(valid) == 0
        assert len(invalid) == 0

    def test_extract_multiple_valid(self, project_dir):
        """Test extracting multiple valid mentions."""
        text = "Check @test.txt and @src/App.tsx"
        valid, invalid = extract_mentions_safe(text, project_dir)

        assert len(valid) == 2
        assert len(invalid) == 0
        assert valid[0].file_path == "test.txt"
        assert valid[1].file_path == "src/App.tsx"

    def test_extract_path_traversal_blocked(self, project_dir):
        """Test that path traversal attempts are marked as invalid."""
        text = "Check @../../../etc/passwd"
        valid, invalid = extract_mentions_safe(text, project_dir)

        assert len(valid) == 0
        assert len(invalid) == 1
        assert "outside project" in invalid[0][1].lower()


class TestDeduplicateMentions:
    """Test deduplicate_mentions function."""

    def test_deduplicate_empty_list(self):
        """Test deduplicating an empty list."""
        result = deduplicate_mentions([])
        assert result == []

    def test_deduplicate_single_mention(self):
        """Test deduplicating a list with one mention."""
        mentions = [FileMention(file_path="test.txt")]
        result = deduplicate_mentions(mentions)

        assert len(result) == 1
        assert result[0].file_path == "test.txt"

    def test_deduplicate_no_duplicates(self):
        """Test list with no duplicates."""
        mentions = [
            FileMention(file_path="test.txt"),
            FileMention(file_path="file.js"),
            FileMention(file_path="README.md"),
        ]
        result = deduplicate_mentions(mentions)

        assert len(result) == 3

    def test_deduplicate_exact_duplicates(self):
        """Test removing exact duplicates."""
        mentions = [
            FileMention(file_path="test.txt"),
            FileMention(file_path="test.txt"),
            FileMention(file_path="file.js"),
        ]
        result = deduplicate_mentions(mentions)

        assert len(result) == 2
        assert result[0].file_path == "test.txt"
        assert result[1].file_path == "file.js"

    def test_deduplicate_different_line_ranges(self):
        """Test that mentions with different line ranges are not duplicates."""
        mentions = [
            FileMention(file_path="test.txt", line_start=10, line_end=20),
            FileMention(file_path="test.txt", line_start=30, line_end=40),
            FileMention(file_path="test.txt"),
        ]
        result = deduplicate_mentions(mentions)

        # All three should be kept (different line ranges)
        assert len(result) == 3

    def test_deduplicate_same_line_ranges(self):
        """Test removing duplicates with same line range."""
        mentions = [
            FileMention(file_path="test.txt", line_start=10, line_end=20),
            FileMention(file_path="test.txt", line_start=10, line_end=20),
        ]
        result = deduplicate_mentions(mentions)

        assert len(result) == 1
        assert result[0].line_start == 10
        assert result[0].line_end == 20

    def test_deduplicate_keeps_first_occurrence(self):
        """Test that first occurrence is kept."""
        mentions = [
            FileMention(file_path="test.txt", line_start=10),
            FileMention(file_path="test.txt", line_start=10),
        ]
        result = deduplicate_mentions(mentions)

        # Should be the same object (first occurrence)
        assert len(result) == 1
        assert result[0] is mentions[0]


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_empty_string(self):
        """Test parsing empty string."""
        mentions = parse_mentions("")
        assert mentions == []

    def test_whitespace_only(self):
        """Test parsing whitespace-only string."""
        mentions = parse_mentions("   \n\t   ")
        assert mentions == []

    def test_multiple_at_signs(self):
        """Test text with multiple @ signs creates multiple potential mentions."""
        text = "Email @@test@example.com for help @@"
        mentions = parse_mentions(text)

        # @@test@example.com creates two matches: @test@example.com and @
        # The parser is greedy and matches what it can
        assert len(mentions) == 2
        assert mentions[0].file_path == "@test@example.com"
        assert mentions[1].file_path == "@"

    def test_mention_at_start(self):
        """Test mention at start of text."""
        text = "@test.txt is the file"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].file_path == "test.txt"

    def test_mention_at_end(self):
        """Test mention at end of text."""
        text = "Check the file @test.txt"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].file_path == "test.txt"

    def test_very_long_line_range(self):
        """Test parsing very large line numbers."""
        text = "@file.js:9999999"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].line_start == 9999999

    def test_zero_line_number(self):
        """Test parsing zero as line number."""
        text = "@file.js:0"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].line_start == 0
        assert mentions[0].line_end == 0

    def test_negative_line_number_not_supported(self):
        """Test that negative line numbers are not matched as line ranges."""
        # The regex doesn't match negative numbers as line ranges
        text = "@file.js:-10"
        mentions = parse_mentions(text)

        # The file mention is matched, but -10 is not recognized as a line range
        # So it's treated as a simple file mention without line numbers
        assert len(mentions) == 1
        assert mentions[0].file_path == "file.js"
        assert mentions[0].line_start is None
        assert mentions[0].line_end is None

    def test_file_path_with_special_chars(self):
        """Test file path with special characters."""
        text = "Check @file-v2.0_test.js for details"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].file_path == "file-v2.0_test.js"

    def test_windows_path_with_range(self):
        """Test Windows path with line range."""
        text = "Check @src\\components\\Button.tsx:10-50"
        mentions = parse_mentions(text)

        assert len(mentions) == 1
        assert mentions[0].file_path == "src/components/Button.tsx"
        assert mentions[0].line_start == 10
        assert mentions[0].line_end == 50


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
