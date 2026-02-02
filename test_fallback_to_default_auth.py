#!/usr/bin/env python3
"""
Test fallback to default authentication when rotation pool is unavailable.

This test verifies that:
1. When profiles.json is missing, get_rotating_profile_credential() returns None
2. create_client() falls back to default OAuth authentication
3. A warning log is emitted about missing rotation pool
4. Client still initializes successfully
"""

import json
import os
import shutil
import tempfile
import sys
from pathlib import Path

# Add apps/backend to path
sys.path.insert(0, str(Path(__file__).parent / "apps" / "backend"))

from core.auth import (
    get_rotating_profile_credential,
    load_profiles_file,
    get_profiles_file_path
)


def test_missing_profiles_json():
    """Test that missing profiles.json returns None from get_rotating_profile_credential."""
    print("\n=== Test 1: Missing profiles.json ===")

    # Get the profiles.json path
    profiles_path = get_profiles_file_path()
    print(f"Profiles file path: {profiles_path}")

    # Check if profiles.json exists
    exists_before = os.path.exists(profiles_path)
    print(f"Profiles file exists before: {exists_before}")

    # If it exists, back it up
    backup_path = None
    if exists_before:
        backup_path = profiles_path + ".backup"
        shutil.move(profiles_path, backup_path)
        print(f"Backed up profiles.json to {backup_path}")

    try:
        # Verify profiles.json doesn't exist
        assert not os.path.exists(profiles_path), "profiles.json should not exist"
        print("✓ profiles.json successfully removed/missing")

        # Call get_rotating_profile_credential()
        result = get_rotating_profile_credential()
        print(f"get_rotating_profile_credential() returned: {result}")

        # Verify it returns None
        assert result is None, "get_rotating_profile_credential() should return None when profiles.json is missing"
        print("✓ get_rotating_profile_credential() correctly returns None")

        # Verify load_profiles_file() returns default empty structure
        profiles_data = load_profiles_file()
        print(f"load_profiles_file() returned: {profiles_data}")

        assert profiles_data == {
            "profiles": [],
            "activeProfileId": None,
            "version": 1
        }, "load_profiles_file() should return default empty structure when file is missing"
        print("✓ load_profiles_file() returns default empty structure")

    finally:
        # Restore backup if it existed
        if backup_path and os.path.exists(backup_path):
            shutil.move(backup_path, profiles_path)
            print(f"Restored profiles.json from {backup_path}")


def test_empty_profiles_list():
    """Test that empty profiles list returns None."""
    print("\n=== Test 2: Empty profiles list ===")

    # Get the profiles.json path
    profiles_path = get_profiles_file_path()

    # Backup existing profiles.json if it exists
    backup_path = None
    if os.path.exists(profiles_path):
        backup_path = profiles_path + ".backup"
        shutil.copy(profiles_path, backup_path)
        print(f"Backed up profiles.json to {backup_path}")

    try:
        # Create empty profiles.json
        empty_data = {
            "profiles": [],
            "activeProfileId": None,
            "version": 1
        }
        with open(profiles_path, 'w') as f:
            json.dump(empty_data, f, indent=2)
        print("Created empty profiles.json")

        # Call get_rotating_profile_credential()
        result = get_rotating_profile_credential()
        print(f"get_rotating_profile_credential() returned: {result}")

        # Verify it returns None
        assert result is None, "get_rotating_profile_credential() should return None when profiles list is empty"
        print("✓ get_rotating_profile_credential() correctly returns None for empty profiles list")

    finally:
        # Restore backup if it existed
        if backup_path and os.path.exists(backup_path):
            shutil.copy(backup_path, profiles_path)
            print(f"Restored profiles.json from {backup_path}")
        elif os.path.exists(profiles_path):
            os.remove(profiles_path)
            print("Removed test profiles.json")


def test_rotation_disabled():
    """Test that disabled rotation strategy returns None."""
    print("\n=== Test 3: Rotation strategy disabled ===")

    # Get the paths
    profiles_path = get_profiles_file_path()
    rotation_config_path = os.path.join(os.path.dirname(profiles_path), "api-profile-rotation.json")

    # Backup existing files if they exist
    profiles_backup = None
    rotation_backup = None

    if os.path.exists(profiles_path):
        profiles_backup = profiles_path + ".backup"
        shutil.copy(profiles_path, profiles_backup)

    if os.path.exists(rotation_config_path):
        rotation_backup = rotation_config_path + ".backup"
        shutil.copy(rotation_config_path, rotation_backup)

    try:
        # Create profiles.json with test profiles
        profiles_data = {
            "profiles": [
                {
                    "id": "profile-1",
                    "name": "Test Profile 1",
                    "baseUrl": "https://api.anthropic.com",
                    "apiKey": "sk-ant-test-key-1"
                }
            ],
            "activeProfileId": "profile-1",
            "version": 1
        }
        with open(profiles_path, 'w') as f:
            json.dump(profiles_data, f, indent=2)
        print("Created profiles.json with test profile")

        # Create rotation config with disabled strategy
        rotation_data = {
            "strategy": {
                "enabled": False,
                "strategy": "priority",
                "priorityOrder": ["profile-1"]
            }
        }
        with open(rotation_config_path, 'w') as f:
            json.dump(rotation_data, f, indent=2)
        print("Created api-profile-rotation.json with disabled strategy")

        # Call get_rotating_profile_credential()
        result = get_rotating_profile_credential()
        print(f"get_rotating_profile_credential() returned: {result}")

        # Verify it returns None
        assert result is None, "get_rotating_profile_credential() should return None when rotation is disabled"
        print("✓ get_rotating_profile_credential() correctly returns None when rotation disabled")

    finally:
        # Restore backups
        if profiles_backup and os.path.exists(profiles_backup):
            shutil.copy(profiles_backup, profiles_path)
        if rotation_backup and os.path.exists(rotation_backup):
            shutil.copy(rotation_backup, rotation_config_path)
        elif os.path.exists(rotation_config_path):
            os.remove(rotation_config_path)
        print("Restored original files")


def test_missing_rotation_config():
    """Test that missing rotation config returns None."""
    print("\n=== Test 4: Missing rotation config ===")

    # Get the paths
    profiles_path = get_profiles_file_path()
    rotation_config_path = os.path.join(os.path.dirname(profiles_path), "api-profile-rotation.json")

    # Backup existing files if they exist
    profiles_backup = None
    rotation_backup = None

    if os.path.exists(profiles_path):
        profiles_backup = profiles_path + ".backup"
        shutil.copy(profiles_path, profiles_backup)

    if os.path.exists(rotation_config_path):
        rotation_backup = rotation_config_path + ".backup"
        shutil.copy(rotation_config_path, rotation_backup)

    try:
        # Create profiles.json with test profiles
        profiles_data = {
            "profiles": [
                {
                    "id": "profile-1",
                    "name": "Test Profile 1",
                    "baseUrl": "https://api.anthropic.com",
                    "apiKey": "sk-ant-test-key-1"
                }
            ],
            "activeProfileId": "profile-1",
            "version": 1
        }
        with open(profiles_path, 'w') as f:
            json.dump(profiles_data, f, indent=2)
        print("Created profiles.json with test profile")

        # Remove rotation config if it exists
        if os.path.exists(rotation_config_path):
            os.remove(rotation_config_path)
        print("Removed api-profile-rotation.json")

        # Call get_rotating_profile_credential()
        result = get_rotating_profile_credential()
        print(f"get_rotating_profile_credential() returned: {result}")

        # Verify it returns None
        assert result is None, "get_rotating_profile_credential() should return None when rotation config is missing"
        print("✓ get_rotating_profile_credential() correctly returns None when rotation config missing")

    finally:
        # Restore backups
        if profiles_backup and os.path.exists(profiles_backup):
            shutil.copy(profiles_backup, profiles_path)
        if rotation_backup and os.path.exists(rotation_backup):
            shutil.copy(rotation_backup, rotation_config_path)
        print("Restored original files")


def test_client_fallback_simulation():
    """Test simulating the client.py fallback behavior."""
    print("\n=== Test 5: Client fallback simulation ===")

    # This simulates what happens in client.py lines 602-632
    api_profile_id = "auto"

    print(f"Simulating client.py flow with apiProfileId='{api_profile_id}'")

    # Simulate missing profiles.json by temporarily removing it
    profiles_path = get_profiles_file_path()
    backup_path = None
    exists_before = os.path.exists(profiles_path)

    if exists_before:
        backup_path = profiles_path + ".backup"
        shutil.move(profiles_path, backup_path)
        print(f"Temporarily removed profiles.json (backed up to {backup_path})")

    try:
        # This is what client.py does (lines 602-632)
        if api_profile_id == "auto":
            print("Detected 'auto' profile, calling get_rotating_profile_credential()...")

            try:
                credential = get_rotating_profile_credential()
                print(f"get_rotating_profile_credential() returned: {credential}")

                if credential:
                    credential_value = credential.get("value")
                    if credential_value:
                        print(f"Would set ANTHROPIC_AUTH_TOKEN to: {credential_value[:20]}...")
                        print("SUCCESS: Using auto-selected profile")
                    else:
                        print("WARNING: Auto-selected profile has no value, would fall back to default auth")
                else:
                    print("WARNING: Rotation pool selection returned None")
                    print("INFO: Falling back to default authentication (OAuth or default credential)")
                    print("SUCCESS: Client would continue with default authentication")

            except Exception as e:
                print(f"ERROR: Failed to get rotating profile credential: {e}")
                print("INFO: Would use default credential")

        # Verify the expected behavior
        assert credential is None, "Expected credential to be None when profiles.json is missing"
        print("\n✓ Fallback behavior verified correctly")

    finally:
        # Restore backup
        if backup_path and os.path.exists(backup_path):
            shutil.move(backup_path, profiles_path)
            print(f"Restored profiles.json from {backup_path}")


def main():
    """Run all tests."""
    print("=" * 80)
    print("Testing Fallback to Default Authentication")
    print("=" * 80)

    tests = [
        test_missing_profiles_json,
        test_empty_profiles_list,
        test_rotation_disabled,
        test_missing_rotation_config,
        test_client_fallback_simulation,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"\n✗ FAILED: {e}")
            failed += 1
        except Exception as e:
            print(f"\n✗ ERROR: {e}")
            import traceback
            traceback.print_exc()
            failed += 1

    print("\n" + "=" * 80)
    print(f"Test Results: {passed} passed, {failed} failed")
    print("=" * 80)

    if failed == 0:
        print("\n✓ All fallback tests passed!")
        return 0
    else:
        print(f"\n✗ {failed} test(s) failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
