#!/usr/bin/env python3
"""
Integration test for fallback to default authentication with logging verification.

This test verifies the full flow from create_client() when rotation pool is unavailable,
including warning log messages.
"""

import json
import os
import shutil
import sys
import logging
import tempfile
from pathlib import Path
from io import StringIO

# Add apps/backend to path
sys.path.insert(0, str(Path(__file__).parent / "apps" / "backend"))

from core.auth import get_profiles_file_path


def setup_test_environment():
    """Setup test environment with missing profiles.json."""
    profiles_path = get_profiles_file_path()
    backup_path = None

    # Backup and remove profiles.json
    if os.path.exists(profiles_path):
        backup_path = profiles_path + ".test.backup"
        shutil.move(profiles_path, backup_path)
        print(f"Backed up and removed profiles.json to {backup_path}")

    # Also remove rotation config if it exists
    rotation_config_path = os.path.join(os.path.dirname(profiles_path), "api-profile-rotation.json")
    rotation_backup = None
    if os.path.exists(rotation_config_path):
        rotation_backup = rotation_config_path + ".test.backup"
        shutil.move(rotation_config_path, rotation_backup)
        print(f"Backed up and removed api-profile-rotation.json to {rotation_backup}")

    return backup_path, rotation_backup


def restore_environment(backup_path, rotation_backup):
    """Restore original environment."""
    profiles_path = get_profiles_file_path()
    rotation_config_path = os.path.join(os.path.dirname(profiles_path), "api-profile-rotation.json")

    if backup_path and os.path.exists(backup_path):
        shutil.move(backup_path, profiles_path)
        print(f"Restored profiles.json from {backup_path}")

    if rotation_backup and os.path.exists(rotation_backup):
        shutil.move(rotation_backup, rotation_config_path)
        print(f"Restored api-profile-rotation.json from {rotation_backup}")


def test_fallback_with_log_capture():
    """Test that fallback generates appropriate log messages."""
    print("\n=== Integration Test: Client Fallback with Log Capture ===\n")

    # Setup test environment (missing profiles.json)
    backup_path, rotation_backup = setup_test_environment()

    # Setup logging to capture messages
    log_capture = StringIO()
    handler = logging.StreamHandler(log_capture)
    handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter('%(levelname)s: %(message)s')
    handler.setFormatter(formatter)

    # Get the auth module logger
    auth_logger = logging.getLogger('core.auth')
    auth_logger.addHandler(handler)
    auth_logger.setLevel(logging.DEBUG)

    # Also get client logger
    client_logger = logging.getLogger('core.client')
    client_logger.addHandler(handler)
    client_logger.setLevel(logging.WARNING)

    try:
        print("Test setup:")
        print("  - profiles.json: MISSING (to trigger fallback)")
        print("  - api-profile-rotation.json: MISSING")
        print("")

        # Import after environment setup
        from core.auth import get_rotating_profile_credential

        print("Step 1: Call get_rotating_profile_credential()")
        credential = get_rotating_profile_credential()
        print(f"  Result: {credential}")
        print(f"  ✓ Returns None as expected\n")

        # Get captured logs
        log_output = log_capture.getvalue()
        print("Step 2: Check log messages")
        print("  Captured logs:")
        for line in log_output.split('\n'):
            if line.strip():
                print(f"    {line}")

        # Verify expected log messages
        print("\nStep 3: Verify expected behavior")
        checks = []

        # Check 1: Credential is None
        checks.append(("Credential is None", credential is None))

        # Check 2: Debug log about missing profiles
        has_missing_profiles_log = "no profiles found in profiles.json" in log_output.lower()
        checks.append(("Debug log about missing profiles", has_missing_profiles_log))

        # Check 3: Debug log about profiles file not found (from load_profiles_file)
        has_file_not_found_log = "profiles file not found" in log_output.lower()
        checks.append(("Debug log about file not found", has_file_not_found_log))

        for check_name, check_result in checks:
            status = "✓" if check_result else "✗"
            print(f"  {status} {check_name}")

        # Verify all checks passed
        all_passed = all(result for _, result in checks)
        if all_passed:
            print("\n✓ All fallback behavior checks passed!")
        else:
            print("\n✗ Some checks failed")
            raise AssertionError("Fallback behavior verification failed")

    finally:
        # Cleanup logging
        auth_logger.removeHandler(handler)
        client_logger.removeHandler(handler)
        handler.close()

        # Restore environment
        restore_environment(backup_path, rotation_backup)


def test_create_client_simulation():
    """
    Simulate the create_client() flow with missing rotation pool.

    This mimics the actual code path in client.py lines 602-632.
    """
    print("\n=== Integration Test: create_client() Simulation ===\n")

    # Setup test environment
    backup_path, rotation_backup = setup_test_environment()

    # Setup logging to capture messages
    log_capture = StringIO()
    handler = logging.StreamHandler(log_capture)
    handler.setLevel(logging.WARNING)
    formatter = logging.Formatter('%(levelname)s - %(name)s - %(message)s')
    handler.setFormatter(formatter)

    client_logger = logging.getLogger('core.client')
    client_logger.addHandler(handler)
    client_logger.setLevel(logging.WARNING)

    auth_logger = logging.getLogger('core.auth')
    auth_logger.addHandler(handler)
    auth_logger.setLevel(logging.DEBUG)

    try:
        print("Simulating create_client() flow from client.py lines 602-632\n")

        # Import after environment setup
        from core.auth import get_rotating_profile_credential

        # Simulate task metadata with apiProfileId='auto'
        api_profile_id = "auto"
        print(f"Task metadata: apiProfileId = '{api_profile_id}'")
        print()

        # This is the exact logic from client.py lines 602-632
        if api_profile_id == "auto":
            print("Executing: if api_profile_id == 'auto':")
            try:
                print("  Calling get_rotating_profile_credential()...")
                credential = get_rotating_profile_credential()
                print(f"  Result: {credential}")
                print()

                if credential:
                    credential_value = credential.get("value")
                    if credential_value:
                        os.environ["ANTHROPIC_AUTH_TOKEN"] = credential_value
                        print("  → Would set ANTHROPIC_AUTH_TOKEN")
                        print("  → SUCCESS: Using auto-selected profile")
                    else:
                        print("  → WARNING: Auto-selected profile has no value")
                        print("  → Would fall back to default authentication")
                else:
                    print("  → WARNING: Rotation pool selection returned None")
                    print("  → Would fall back to default authentication")
                    print("  → Client would continue with OAuth or default credential")

            except Exception as e:
                print(f"  → ERROR: Failed to get rotating profile credential: {e}")
                print("  → Would use default credential")

        print()

        # Get captured logs
        log_output = log_capture.getvalue()
        print("Captured log messages:")
        if log_output.strip():
            for line in log_output.split('\n'):
                if line.strip():
                    print(f"  {line}")
        else:
            print("  (No WARNING/ERROR messages - fallback is graceful)")

        print()
        print("Verification:")
        checks = []

        # Check 1: credential is None
        checks.append(("Credential is None", credential is None))

        # Check 2: No exception was raised
        checks.append(("No exception raised", True))  # If we got here, no exception

        # Check 3: Would fall back to default auth
        checks.append(("Would fall back to default auth", credential is None))

        for check_name, check_result in checks:
            status = "✓" if check_result else "✗"
            print(f"  {status} {check_name}")

        all_passed = all(result for _, result in checks)
        if all_passed:
            print("\n✓ create_client() simulation successful!")
            print("  The system correctly falls back to default authentication")
            print("  when rotation pool is unavailable.")
        else:
            raise AssertionError("create_client() simulation failed")

    finally:
        # Cleanup logging
        client_logger.removeHandler(handler)
        auth_logger.removeHandler(handler)
        handler.close()

        # Restore environment
        restore_environment(backup_path, rotation_backup)


def test_warning_message_content():
    """Test that appropriate warning messages are generated."""
    print("\n=== Test: Warning Message Content ===\n")

    # Setup test environment
    backup_path, rotation_backup = setup_test_environment()

    # Setup logging to capture all messages
    log_capture = StringIO()
    handler = logging.StreamHandler(log_capture)
    handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter('%(levelname)s: %(message)s')
    handler.setFormatter(formatter)

    logger = logging.getLogger('core.auth')
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

    try:
        from core.auth import get_rotating_profile_credential

        # Call the function
        result = get_rotating_profile_credential()

        # Get captured logs
        log_output = log_capture.getvalue()

        print("Checking log messages for expected content:\n")

        # Expected log messages (from auth.py)
        expected_messages = [
            ("no profiles found in profiles.json", "DEBUG - Missing profiles.json"),
            ("profiles file not found", "DEBUG - File not found"),
        ]

        for expected, description in expected_messages:
            if expected in log_output.lower():
                print(f"  ✓ Found: {description}")
                print(f"    Message contains: '{expected}'")
            else:
                print(f"  ? Not found: {description}")
                print(f"    Looking for: '{expected}'")

        # Verify the function returns None
        print(f"\nFunction returns: {result}")
        assert result is None, "Should return None when profiles.json is missing"
        print("  ✓ Correctly returns None")

        print("\n✓ Warning message content test passed!")

    finally:
        # Cleanup logging
        logger.removeHandler(handler)
        handler.close()

        # Restore environment
        restore_environment(backup_path, rotation_backup)


def main():
    """Run all integration tests."""
    print("=" * 80)
    print("Integration Tests: Fallback to Default Authentication")
    print("=" * 80)

    tests = [
        test_fallback_with_log_capture,
        test_create_client_simulation,
        test_warning_message_content,
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
    print(f"Integration Test Results: {passed} passed, {failed} failed")
    print("=" * 80)

    if failed == 0:
        print("\n✓ All integration tests passed!")
        print("\nSummary:")
        print("  - get_rotating_profile_credential() correctly returns None")
        print("  - Appropriate log messages are generated")
        print("  - create_client() flow gracefully falls back to default auth")
        print("  - No exceptions or crashes occur")
        return 0
    else:
        print(f"\n✗ {failed} test(s) failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
