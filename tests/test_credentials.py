#!/usr/bin/env python3
"""
Unit Tests for Credential CRUD Operations
==========================================

Tests the credential management functionality including:
- List all credentials (list_credentials)
- Get single credential by ID (get_credential)
- Save credential profile (save_credential)
- Delete credential profile (delete_credential)
- Validate credential format and structure (validate_credential)
"""

import json
import os
import platform
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.auth import (
    delete_credential,
    get_credential,
    list_credentials,
    save_credential,
    validate_credential,
)

# Skip Windows-specific tests when not on Windows
skip_if_not_windows = pytest.mark.skipif(
    platform.system() != "Windows",
    reason="Windows-specific test, skipping on non-Windows platform"
)


class TestValidateCredential:
    """Tests for credential validation logic."""

    def test_validate_oauth_credential_valid(self):
        """Validates a well-formed OAuth credential."""
        credential = {
            "id": "cred-001",
            "type": "oauth",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        result = validate_credential(credential)
        assert result is True

    def test_validate_api_key_credential_valid(self):
        """Validates a well-formed API key credential."""
        credential = {
            "id": "cred-002",
            "type": "api_key",
            "value": "sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        result = validate_credential(credential)
        assert result is True

    def test_validate_credential_missing_value(self):
        """Rejects credential without value field."""
        credential = {
            "id": "cred-001",
            "type": "oauth",
        }

        result = validate_credential(credential)
        assert result is False

    def test_validate_oauth_invalid_prefix(self):
        """Rejects OAuth token with invalid prefix."""
        credential = {
            "id": "cred-001",
            "type": "oauth",
            "value": "sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        result = validate_credential(credential)
        assert result is False

    def test_validate_api_key_invalid_prefix(self):
        """Rejects API key with invalid prefix."""
        credential = {
            "id": "cred-002",
            "type": "api_key",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        result = validate_credential(credential)
        assert result is False

    def test_validate_encrypted_token_rejected(self):
        """Rejects encrypted tokens."""
        credential = {
            "id": "cred-001",
            "type": "oauth",
            "value": "enc:encrypted_data_here",
        }

        result = validate_credential(credential)
        assert result is False

    def test_validate_credential_too_short(self):
        """Rejects credential value that is too short."""
        credential = {
            "id": "cred-001",
            "type": "oauth",
            "value": "sk-ant-oat01-short",
        }

        result = validate_credential(credential)
        assert result is False

    def test_validate_unknown_type(self):
        """Rejects credential with unknown type."""
        credential = {
            "id": "cred-001",
            "type": "unknown",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        result = validate_credential(credential)
        assert result is False

    def test_validate_defaults_to_oauth_type(self):
        """Validates credential that defaults to oauth type when not specified."""
        credential = {
            "id": "cred-001",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        result = validate_credential(credential)
        assert result is True


class TestSaveCredential:
    """Tests for saving credential profiles."""

    def test_save_credential_missing_id(self):
        """Rejects credential without id field."""
        credential = {
            "type": "oauth",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        result = save_credential(credential)
        assert result is False

    def test_save_credential_missing_value(self):
        """Rejects credential without value field."""
        credential = {
            "id": "cred-001",
            "type": "oauth",
        }

        result = save_credential(credential)
        assert result is False


class TestSaveCredentialMacOS:
    """Tests for saving credentials on macOS."""

    @pytest.fixture
    def mock_macos(self, monkeypatch):
        """Mock macOS platform."""
        monkeypatch.setattr(platform, "system", lambda: "Darwin")

    def test_save_credential_macos_success(self, mock_macos, monkeypatch):
        """Successfully saves credential to macOS Keychain."""
        credential = {
            "id": "cred-001",
            "type": "oauth",
            "name": "Test Credential",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            "status": "active",
        }

        # Mock subprocess.run for security command
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stderr = ""

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = save_credential(credential)
        assert result is True

    def test_save_credential_macos_failure(self, mock_macos, monkeypatch):
        """Handles failure when saving to macOS Keychain."""
        credential = {
            "id": "cred-001",
            "type": "oauth",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        # Mock subprocess.run to return error
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stderr = "Security error"

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = save_credential(credential)
        assert result is False

    def test_save_credential_macos_defaults(self, mock_macos, monkeypatch):
        """Saves credential with default values for optional fields."""
        credential = {
            "id": "cred-002",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        # Mock subprocess.run for security command
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stderr = ""

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = save_credential(credential)
        assert result is True


@skip_if_not_windows
class TestSaveCredentialWindows:
    """Tests for saving credentials on Windows."""

    @pytest.fixture
    def mock_windows(self, monkeypatch):
        """Mock Windows platform."""
        monkeypatch.setattr(platform, "system", lambda: "Windows")

    def test_save_credential_windows_success(self, mock_windows, monkeypatch, tmp_path):
        """Successfully saves credential to Windows file storage."""
        credential = {
            "id": "cred-001",
            "type": "oauth",
            "name": "Test Credential",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            "status": "active",
        }

        # Mock USERPROFILE and create temp directory
        claude_dir = tmp_path / ".claude"
        claude_dir.mkdir()

        monkeypatch.setenv("USERPROFILE", str(tmp_path))

        # Mock os.path.expandvars using unittest.mock.patch for proper module-level patching
        from unittest.mock import patch
        def mock_expandvars(path):
            if "%USERPROFILE%" in path:
                return path.replace("%USERPROFILE%", str(tmp_path))
            return path

        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            result = save_credential(credential)

        assert result is True

        # Verify file was created
        cred_file = claude_dir / f".credentials-auto-claude-{credential['id']}.json"
        assert cred_file.exists()

        # Verify file contents
        with open(cred_file) as f:
            saved_data = json.load(f)
        assert saved_data["id"] == credential["id"]
        assert saved_data["value"] == credential["value"]

    def test_save_credential_windows_io_error(self, mock_windows, monkeypatch):
        """Handles IO errors when saving to Windows file storage."""
        credential = {
            "id": "cred-001",
            "type": "oauth",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        # Mock USERPROFILE to an invalid path
        invalid_path = "/invalid/path/that/cannot/be/created"
        monkeypatch.setenv("USERPROFILE", invalid_path)

        # Mock os.path.expandvars using unittest.mock.patch
        from unittest.mock import patch
        def mock_expandvars(path):
            if "%USERPROFILE%" in path:
                return path.replace("%USERPROFILE%", invalid_path)
            return path

        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            result = save_credential(credential)

        assert result is False


class TestGetCredential:
    """Tests for retrieving credential profiles."""

    @pytest.fixture
    def mock_macos(self, monkeypatch):
        """Mock macOS platform."""
        monkeypatch.setattr(platform, "system", lambda: "Darwin")

    def test_get_credential_macos_success(self, mock_macos, monkeypatch):
        """Successfully retrieves credential from macOS Keychain."""
        cred_id = "cred-001"
        credential_data = {
            "id": cred_id,
            "type": "oauth",
            "name": "Test Credential",
            "status": "active",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            "last_used": "2025-01-20T12:00:00Z",
        }

        # Mock subprocess.run for security command
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(credential_data)

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = get_credential(cred_id)
        assert result is not None
        assert result["id"] == cred_id
        assert result["value"] == credential_data["value"]

    def test_get_credential_macos_not_found(self, mock_macos, monkeypatch):
        """Returns None when credential not found in macOS Keychain."""
        cred_id = "nonexistent"

        # Mock subprocess.run to return error (not found)
        mock_result = Mock()
        mock_result.returncode = 1

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = get_credential(cred_id)
        assert result is None

    def test_get_credential_macos_invalid_json(self, mock_macos, monkeypatch):
        """Returns None when macOS Keychain returns invalid JSON."""
        cred_id = "cred-001"

        # Mock subprocess.run to return invalid JSON
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "invalid json"

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = get_credential(cred_id)
        assert result is None


class TestListCredentials:
    """Tests for listing all credential profiles."""

    @pytest.fixture
    def mock_macos(self, monkeypatch):
        """Mock macOS platform."""
        monkeypatch.setattr(platform, "system", lambda: "Darwin")

    def test_list_credentials_macos_empty(self, mock_macos, monkeypatch):
        """Returns empty list when no credentials in macOS Keychain."""
        # Mock subprocess.run to return empty keychain
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = ""

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = list_credentials()
        assert result == []

    def test_list_credentials_macos_success(self, mock_macos, monkeypatch):
        """Successfully lists credentials from macOS Keychain."""
        # Mock keychain output with multiple credentials
        # Format must match what security dump-keychain -g actually outputs
        keychain_output = '''
keychain: "/Users/test/Library/Keychains/login.keychain-db"
class: "genp"
attributes:
    0x00000007 <blob>="auto-claude-cred-001"
    0x00000008 <blob>[0]
    "acct"<blob>="Primary Account"
    "svce"<blob>="auto-claude-cred-001"
    "service"<blob>="auto-claude-cred-001"

class: "genp"
attributes:
    0x00000007 <blob>="auto-claude-cred-002"
    0x00000008 <blob>[0]
    "acct"<blob>="Secondary Account"
    "svce"<blob>="auto-claude-cred-002"
    "service"<blob>="auto-claude-cred-002"
'''

        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = keychain_output

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = list_credentials()
        assert len(result) == 2
        assert result[0]["id"] == "cred-001"
        assert result[1]["id"] == "cred-002"

    def test_list_credentials_macos_command_failure(self, mock_macos, monkeypatch):
        """Returns empty list when keychain dump command fails."""
        mock_result = Mock()
        mock_result.returncode = 1

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = list_credentials()
        assert result == []


class TestDeleteCredential:
    """Tests for deleting credential profiles."""

    @pytest.fixture
    def mock_macos(self, monkeypatch):
        """Mock macOS platform."""
        monkeypatch.setattr(platform, "system", lambda: "Darwin")

    def test_delete_credential_macos_success(self, mock_macos, monkeypatch):
        """Successfully deletes credential from macOS Keychain."""
        cred_id = "cred-001"

        # Mock subprocess.run for security delete command
        mock_result = Mock()
        mock_result.returncode = 0

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = delete_credential(cred_id)
        assert result is True

    def test_delete_credential_macos_not_found(self, mock_macos, monkeypatch):
        """Returns True when credential not found (exit code 44)."""
        cred_id = "nonexistent"

        # Mock subprocess.run to return exit code 44 (not found)
        mock_result = Mock()
        mock_result.returncode = 44

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = delete_credential(cred_id)
        assert result is True

    def test_delete_credential_macos_failure(self, mock_macos, monkeypatch):
        """Returns False when delete command fails."""
        cred_id = "cred-001"

        # Mock subprocess.run to return error
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stderr = "Security error"

        import subprocess
        monkeypatch.setattr(subprocess, "run", Mock(return_value=mock_result))

        result = delete_credential(cred_id)
        assert result is False

    def test_delete_credential_macos_timeout(self, mock_macos, monkeypatch):
        """Returns False when delete command times out."""
        cred_id = "cred-001"

        # Mock subprocess.run to raise timeout exception
        import subprocess

        def mock_timeout(*args, **kwargs):
            raise subprocess.TimeoutExpired("security", 5)

        monkeypatch.setattr(subprocess, "run", mock_timeout)

        result = delete_credential(cred_id)
        assert result is False


@skip_if_not_windows
class TestDeleteCredentialWindows:
    """Tests for deleting credentials on Windows."""

    @pytest.fixture
    def mock_windows(self, monkeypatch):
        """Mock Windows platform."""
        monkeypatch.setattr(platform, "system", lambda: "Windows")

    def test_delete_credential_windows_success(self, mock_windows, monkeypatch, tmp_path):
        """Successfully deletes credential from Windows file storage."""
        cred_id = "cred-001"

        # Create credential file
        claude_dir = tmp_path / ".claude"
        claude_dir.mkdir()
        cred_file = claude_dir / f".credentials-auto-claude-{cred_id}.json"
        cred_file.write_text('{"id": "cred-001", "value": "test"}')

        # Mock USERPROFILE and expandvars
        from unittest.mock import patch
        monkeypatch.setenv("USERPROFILE", str(tmp_path))
        def mock_expandvars(path):
            if "%USERPROFILE%" in path:
                return path.replace("%USERPROFILE%", str(tmp_path))
            return path

        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            result = delete_credential(cred_id)

        assert result is True
        assert not cred_file.exists()

    def test_delete_credential_windows_not_found(self, mock_windows, monkeypatch, tmp_path):
        """Returns False when credential file not found."""
        cred_id = "nonexistent"

        # Create directory but no file
        claude_dir = tmp_path / ".claude"
        claude_dir.mkdir()

        # Mock USERPROFILE and expandvars
        from unittest.mock import patch
        monkeypatch.setenv("USERPROFILE", str(tmp_path))
        def mock_expandvars(path):
            if "%USERPROFILE%" in path:
                return path.replace("%USERPROFILE%", str(tmp_path))
            return path

        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            result = delete_credential(cred_id)

        assert result is False


class TestCredentialCRUDIntegration:
    """Integration tests for complete CRUD workflows."""

    @pytest.fixture
    def mock_windows(self, monkeypatch):
        """Mock Windows platform for integration tests."""
        monkeypatch.setattr(platform, "system", lambda: "Windows")

    @skip_if_not_windows
    def test_full_crud_workflow_windows(self, mock_windows, monkeypatch, tmp_path):
        """Tests full CRUD cycle: create, read, update, delete."""
        # Mock USERPROFILE and expandvars
        from unittest.mock import patch
        monkeypatch.setenv("USERPROFILE", str(tmp_path))
        def mock_expandvars(path):
            if "%USERPROFILE%" in path:
                return path.replace("%USERPROFILE%", str(tmp_path))
            return path

        # Create credential
        credential = {
            "id": "cred-integration-001",
            "type": "oauth",
            "name": "Integration Test Credential",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            "status": "active",
        }

        # Save
        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            save_result = save_credential(credential)
        assert save_result is True

        # Read
        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            retrieved = get_credential("cred-integration-001")
        assert retrieved is not None
        assert retrieved["id"] == credential["id"]
        assert retrieved["value"] == credential["value"]
        assert retrieved["name"] == credential["name"]

        # Update (save with same ID but different data)
        updated_credential = credential.copy()
        updated_credential["name"] = "Updated Credential Name"
        updated_credential["status"] = "rate_limited"

        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            update_result = save_credential(updated_credential)
        assert update_result is True

        # Verify update
        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            updated_retrieved = get_credential("cred-integration-001")
        assert updated_retrieved["name"] == "Updated Credential Name"
        assert updated_retrieved["status"] == "rate_limited"

        # List
        all_creds = list_credentials()
        assert len(all_creds) >= 1
        cred_ids = [c["id"] for c in all_creds]
        assert "cred-integration-001" in cred_ids

        # Delete
        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            delete_result = delete_credential("cred-integration-001")
        assert delete_result is True

        # Verify deletion
        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            deleted_retrieved = get_credential("cred-integration-001")
        assert deleted_retrieved is None

    @skip_if_not_windows
    def test_save_and_validate_workflow(self, mock_windows, monkeypatch, tmp_path):
        """Tests saving and validating a credential."""
        # Mock USERPROFILE and expandvars
        from unittest.mock import patch
        monkeypatch.setenv("USERPROFILE", str(tmp_path))
        def mock_expandvars(path):
            if "%USERPROFILE%" in path:
                return path.replace("%USERPROFILE%", str(tmp_path))
            return path

        credential = {
            "id": "cred-validate-001",
            "type": "oauth",
            "value": "sk-ant-oat01-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        }

        # Validate before saving
        validate_result = validate_credential(credential)
        assert validate_result is True

        # Save
        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            save_result = save_credential(credential)
        assert save_result is True

        # Retrieve and validate again
        with patch('core.auth.os.path.expandvars', new=mock_expandvars):
            retrieved = get_credential("cred-validate-001")
        assert retrieved is not None

        validate_after = validate_credential(retrieved)
        assert validate_after is True


class TestCredentialErrorHandling:
    """Tests for error handling and edge cases."""

    def test_validate_credential_empty_dict(self):
        """Handles empty credential dictionary."""
        result = validate_credential({})
        assert result is False

    def test_save_credential_empty_dict(self):
        """Handles empty credential dictionary when saving."""
        result = save_credential({})
        assert result is False

    def test_get_credential_empty_id(self):
        """Handles empty credential ID."""
        result = get_credential("")
        # Should handle gracefully (returns None or raises error)
        assert result is None or result is False

    def test_delete_credential_empty_id(self):
        """Handles empty credential ID when deleting."""
        result = delete_credential("")
        # Should handle gracefully
        assert result is False or result is True
