#!/usr/bin/env python3
"""
Unit Tests for Insights Runner
===============================

Tests the insights runner functionality including:
- load_roadmap_context() - Roadmap data loading and summarization
- Error handling for missing files and invalid JSON
- Status and priority breakdown calculations

This tests the core context loading functions used by the insights chat system.
"""

import json
from pathlib import Path

import pytest


# ============================================================================
# Copy of load_roadmap_context function for testing
# This avoids complex import chains that require SDK dependencies
# ============================================================================

def load_roadmap_context(project_dir: str) -> dict | None:
    """Load roadmap context for the AI.

    Args:
        project_dir: Path to the project directory

    Returns:
        Dictionary with roadmap summary (features, count, status breakdown)
        or None if roadmap not found.
    """
    roadmap_path = Path(project_dir) / ".auto-claude" / "roadmap" / "roadmap.json"

    if not roadmap_path.exists():
        return None

    try:
        with open(roadmap_path, encoding="utf-8") as f:
            roadmap = json.load(f)

        features = roadmap.get("features", [])

        # Build status breakdown
        status_counts = {}
        for feature in features:
            status = feature.get("status", "not_started")
            status_counts[status] = status_counts.get(status, 0) + 1

        # Get priority breakdown
        priority_counts = {}
        for feature in features:
            priority = feature.get("priority", "should")
            priority_counts[priority] = priority_counts.get(priority, 0) + 1

        # Summarize features
        feature_summary = [
            {
                "id": f.get("id", ""),
                "title": f.get("title", ""),
                "status": f.get("status", ""),
                "priority": f.get("priority", "should"),
                "complexity": f.get("complexity", "medium"),
            }
            for f in features
        ]

        return {
            "total_features": len(features),
            "status_breakdown": status_counts,
            "priority_breakdown": priority_counts,
            "features": feature_summary,
            "description": roadmap.get("description", ""),
        }

    except (json.JSONDecodeError, OSError):
        return None


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture(scope="function")
def temp_project_dir(tmp_path):
    """
    Create a temporary project directory with .auto-claude structure.
    """
    # Create .auto-claude/roadmap directory structure
    roadmap_dir = tmp_path / ".auto-claude" / "roadmap"
    roadmap_dir.mkdir(parents=True)

    return tmp_path


@pytest.fixture(scope="function")
def valid_roadmap_data():
    """
    Return valid roadmap data for testing.
    """
    return {
        "description": "Test roadmap description",
        "features": [
            {
                "id": "feature-1",
                "title": "User Authentication",
                "status": "completed",
                "priority": "must",
                "complexity": "large",
                "description": "Add login functionality",
                "rationale": "Users need to authenticate",
                "impact": "high",
                "dependencies": [],
                "acceptanceCriteria": ["User can login", "User can logout"],
                "userStories": ["As a user, I want to login"]
            },
            {
                "id": "feature-2",
                "title": "Dashboard",
                "status": "in_progress",
                "priority": "should",
                "complexity": "medium",
                "description": "Create main dashboard",
                "rationale": "Users need overview",
                "impact": "medium",
                "dependencies": ["feature-1"],
                "acceptanceCriteria": ["Dashboard displays data"],
                "userStories": ["As a user, I want to see my data"]
            },
            {
                "id": "feature-3",
                "title": "Settings Page",
                "status": "not_started",
                "priority": "could",
                "complexity": "small",
                "description": "User settings",
                "rationale": "Users want customization",
                "impact": "low",
                "dependencies": [],
                "acceptanceCriteria": ["User can change settings"],
                "userStories": ["As a user, I want to customize"]
            }
        ]
    }


# ============================================================================
# load_roadmap_context() Success Tests
# ============================================================================

class TestLoadRoadmapContextSuccess:
    """Tests for successful roadmap context loading."""

    def test_load_roadmap_context_returns_dict(self, temp_project_dir, valid_roadmap_data):
        """Verify load_roadmap_context() returns a dictionary when roadmap exists."""
        # Create roadmap.json file
        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(valid_roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert result is not None
        assert isinstance(result, dict)

    def test_load_roadmap_context_includes_total_features(self, temp_project_dir, valid_roadmap_data):
        """Verify total_features count is correct."""
        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(valid_roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert result["total_features"] == 3

    def test_load_roadmap_context_status_breakdown(self, temp_project_dir, valid_roadmap_data):
        """Verify status_breakdown is calculated correctly."""
        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(valid_roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert "status_breakdown" in result
        assert result["status_breakdown"]["completed"] == 1
        assert result["status_breakdown"]["in_progress"] == 1
        assert result["status_breakdown"]["not_started"] == 1

    def test_load_roadmap_context_priority_breakdown(self, temp_project_dir, valid_roadmap_data):
        """Verify priority_breakdown is calculated correctly."""
        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(valid_roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert "priority_breakdown" in result
        assert result["priority_breakdown"]["must"] == 1
        assert result["priority_breakdown"]["should"] == 1
        assert result["priority_breakdown"]["could"] == 1

    def test_load_roadmap_context_features_list(self, temp_project_dir, valid_roadmap_data):
        """Verify features list is correctly summarized."""
        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(valid_roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert "features" in result
        assert len(result["features"]) == 3

        # Check first feature
        feature = result["features"][0]
        assert feature["id"] == "feature-1"
        assert feature["title"] == "User Authentication"
        assert feature["status"] == "completed"
        assert feature["priority"] == "must"
        assert feature["complexity"] == "large"

    def test_load_roadmap_context_includes_description(self, temp_project_dir, valid_roadmap_data):
        """Verify roadmap description is included."""
        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(valid_roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert "description" in result
        assert result["description"] == "Test roadmap description"

    def test_load_roadmap_context_empty_features_list(self, temp_project_dir):
        """Verify roadmap with empty features list is handled."""
        empty_roadmap = {
            "description": "Empty roadmap",
            "features": []
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(empty_roadmap, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert result is not None
        assert result["total_features"] == 0
        assert result["status_breakdown"] == {}
        assert result["priority_breakdown"] == {}
        assert result["features"] == []

    def test_load_roadmap_context_default_status_values(self, temp_project_dir):
        """Verify features without status get default 'not_started' value in breakdown."""
        roadmap_data = {
            "description": "Test",
            "features": [
                {
                    "id": "f1",
                    "title": "Feature 1",
                    "priority": "should",
                    "complexity": "medium"
                    # No status field
                }
            ]
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        # Breakdown counts "not_started" as default
        assert result["status_breakdown"]["not_started"] == 1
        # Feature summary uses empty string as default for status
        assert result["features"][0]["status"] == ""

    def test_load_roadmap_context_default_priority_values(self, temp_project_dir):
        """Verify features without priority get default 'should' value."""
        roadmap_data = {
            "description": "Test",
            "features": [
                {
                    "id": "f1",
                    "title": "Feature 1",
                    "status": "not_started",
                    "complexity": "medium"
                    # No priority field
                }
            ]
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        # Should default to "should"
        assert result["priority_breakdown"]["should"] == 1
        assert result["features"][0]["priority"] == "should"

    def test_load_roadmap_context_default_complexity_values(self, temp_project_dir):
        """Verify features without complexity get default 'medium' value."""
        roadmap_data = {
            "description": "Test",
            "features": [
                {
                    "id": "f1",
                    "title": "Feature 1",
                    "status": "not_started",
                    "priority": "should"
                    # No complexity field
                }
            ]
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        # Should default to "medium"
        assert result["features"][0]["complexity"] == "medium"


# ============================================================================
# load_roadmap_context() Error Handling Tests
# ============================================================================

class TestLoadRoadmapContextErrors:
    """Tests for error handling in load_roadmap_context()."""

    def test_load_roadmap_context_missing_file_returns_none(self, temp_project_dir):
        """Verify None is returned when roadmap.json doesn't exist."""
        # Don't create the roadmap file
        result = load_roadmap_context(str(temp_project_dir))

        assert result is None

    def test_load_roadmap_context_invalid_json_returns_none(self, temp_project_dir):
        """Verify None is returned for invalid JSON."""
        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            f.write("{ invalid json }")

        result = load_roadmap_context(str(temp_project_dir))

        assert result is None

    def test_load_roadmap_context_empty_file_returns_none(self, temp_project_dir):
        """Verify None is returned for empty file."""
        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        roadmap_file.write_text("")

        result = load_roadmap_context(str(temp_project_dir))

        assert result is None

    def test_load_roadmap_context_missing_features_key(self, temp_project_dir):
        """Verify roadmap without features key is handled gracefully."""
        roadmap_data = {
            "description": "Test"
            # No "features" key
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        # Should handle with empty features list
        assert result is not None
        assert result["total_features"] == 0

    def test_load_roadmap_context_non_dict_features(self, temp_project_dir):
        """Verify features set to non-list value is handled."""
        roadmap_data = {
            "description": "Test",
            "features": "not a list"
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        # When features is not a list, iteration will fail with AttributeError
        # The function's exception handling only catches JSONDecodeError and OSError
        # So this will crash - the test verifies that the implementation doesn't
        # explicitly handle this edge case
        with pytest.raises(AttributeError):
            load_roadmap_context(str(temp_project_dir))


# ============================================================================
# load_roadmap_context() Edge Cases Tests
# ============================================================================

class TestLoadRoadmapContextEdgeCases:
    """Tests for edge cases in load_roadmap_context()."""

    def test_load_roadmap_context_large_features_list(self, temp_project_dir):
        """Verify roadmap with many features is handled efficiently."""
        # Create 100 features
        features = []
        for i in range(100):
            features.append({
                "id": f"feature-{i}",
                "title": f"Feature {i}",
                "status": "not_started",
                "priority": "should",
                "complexity": "small"
            })

        roadmap_data = {
            "description": "Large roadmap",
            "features": features
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert result is not None
        assert result["total_features"] == 100
        assert len(result["features"]) == 100

    def test_load_roadmap_context_multiple_features_same_status(self, temp_project_dir):
        """Verify status breakdown counts correctly for same status."""
        roadmap_data = {
            "description": "Test",
            "features": [
                {"id": "f1", "title": "F1", "status": "completed", "priority": "must", "complexity": "small"},
                {"id": "f2", "title": "F2", "status": "completed", "priority": "should", "complexity": "medium"},
                {"id": "f3", "title": "F3", "status": "completed", "priority": "could", "complexity": "large"}
            ]
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert result["status_breakdown"]["completed"] == 3

    def test_load_roadmap_context_feature_with_minimal_data(self, temp_project_dir):
        """Verify feature with only required fields is handled."""
        roadmap_data = {
            "description": "Test",
            "features": [
                {"id": "f1"}  # Only ID, no other fields
            ]
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert result is not None
        assert result["features"][0]["id"] == "f1"
        assert result["features"][0]["title"] == ""
        assert result["features"][0]["status"] == ""  # Empty string default in feature summary
        assert result["features"][0]["priority"] == "should"  # Default
        assert result["features"][0]["complexity"] == "medium"  # Default
        # But breakdown counts with defaults
        assert result["status_breakdown"]["not_started"] == 1

    def test_load_roadmap_context_unicode_content(self, temp_project_dir):
        """Verify roadmap with unicode characters is handled correctly."""
        roadmap_data = {
            "description": "Test with émojis 🎉 and ünicöde",
            "features": [
                {
                    "id": "f1",
                    "title": "Féature Ñame",
                    "status": "completed",
                    "priority": "must",
                    "complexity": "medium"
                }
            ]
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f, ensure_ascii=False)

        result = load_roadmap_context(str(temp_project_dir))

        assert result is not None
        assert "🎉" in result["description"]
        assert result["features"][0]["title"] == "Féature Ñame"

    def test_load_roadmap_context_special_characters_in_json(self, temp_project_dir):
        """Verify special characters in JSON are handled."""
        roadmap_data = {
            "description": "Test with \"quotes\" and \n newlines",
            "features": [
                {
                    "id": "f1",
                    "title": "Feature with 'single' and \"double\" quotes",
                    "status": "not_started",
                    "priority": "should",
                    "complexity": "medium"
                }
            ]
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert result is not None
        assert "quotes" in result["description"]
        assert "single" in result["features"][0]["title"]

    def test_load_roadmap_context_all_status_values(self, temp_project_dir):
        """Verify all possible status values are counted correctly."""
        roadmap_data = {
            "description": "Test",
            "features": [
                {"id": "f1", "title": "F1", "status": "not_started", "priority": "should", "complexity": "small"},
                {"id": "f2", "title": "F2", "status": "in_progress", "priority": "should", "complexity": "small"},
                {"id": "f3", "title": "F3", "status": "completed", "priority": "should", "complexity": "small"},
                {"id": "f4", "title": "F4", "status": "blocked", "priority": "should", "complexity": "small"},
                {"id": "f5", "title": "F5", "status": "deferred", "priority": "should", "complexity": "small"}
            ]
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert result["status_breakdown"]["not_started"] == 1
        assert result["status_breakdown"]["in_progress"] == 1
        assert result["status_breakdown"]["completed"] == 1
        assert result["status_breakdown"]["blocked"] == 1
        assert result["status_breakdown"]["deferred"] == 1

    def test_load_roadmap_context_all_priority_values(self, temp_project_dir):
        """Verify all possible priority values are counted correctly."""
        roadmap_data = {
            "description": "Test",
            "features": [
                {"id": "f1", "title": "F1", "status": "not_started", "priority": "must", "complexity": "small"},
                {"id": "f2", "title": "F2", "status": "not_started", "priority": "should", "complexity": "small"},
                {"id": "f3", "title": "F3", "status": "not_started", "priority": "could", "complexity": "small"},
                {"id": "f4", "title": "F4", "status": "not_started", "priority": "wont", "complexity": "small"}
            ]
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        assert result["priority_breakdown"]["must"] == 1
        assert result["priority_breakdown"]["should"] == 1
        assert result["priority_breakdown"]["could"] == 1
        assert result["priority_breakdown"]["wont"] == 1

    def test_load_roadmap_context_all_complexity_values(self, temp_project_dir):
        """Verify all complexity values are preserved correctly."""
        roadmap_data = {
            "description": "Test",
            "features": [
                {"id": "f1", "title": "F1", "status": "not_started", "priority": "should", "complexity": "trivial"},
                {"id": "f2", "title": "F2", "status": "not_started", "priority": "should", "complexity": "small"},
                {"id": "f3", "title": "F3", "status": "not_started", "priority": "should", "complexity": "medium"},
                {"id": "f4", "title": "F4", "status": "not_started", "priority": "should", "complexity": "large"},
                {"id": "f5", "title": "F5", "status": "not_started", "priority": "should", "complexity": "complex"}
            ]
        }

        roadmap_file = temp_project_dir / ".auto-claude" / "roadmap" / "roadmap.json"
        with open(roadmap_file, 'w', encoding='utf-8') as f:
            json.dump(roadmap_data, f)

        result = load_roadmap_context(str(temp_project_dir))

        complexities = [f["complexity"] for f in result["features"]]
        assert "trivial" in complexities
        assert "small" in complexities
        assert "medium" in complexities
        assert "large" in complexities
        assert "complex" in complexities
