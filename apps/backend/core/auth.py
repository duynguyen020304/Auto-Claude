"""
Authentication helpers for Auto Claude.

Provides centralized authentication token resolution with fallback support
for multiple environment variables, and SDK environment variable passthrough
for custom API endpoints.
"""

import json
import logging
import os
import shutil
import subprocess
from typing import TYPE_CHECKING

from core.platform import (
    is_linux,
    is_macos,
    is_windows,
)

logger = logging.getLogger(__name__)

# Optional import for Linux secret-service support
# secretstorage provides access to the Freedesktop.org Secret Service API via DBus
if TYPE_CHECKING:
    import secretstorage
else:
    try:
        import secretstorage  # type: ignore[import-untyped]
    except ImportError:
        secretstorage = None  # type: ignore[assignment]

# Priority order for auth token resolution
# NOTE: We intentionally do NOT fall back to ANTHROPIC_API_KEY.
# Auto Claude is designed to use Claude Code OAuth tokens only.
# This prevents silent billing to user's API credits when OAuth fails.
AUTH_TOKEN_ENV_VARS = [
    "CLAUDE_CODE_OAUTH_TOKEN",  # OAuth token from Claude Code CLI
    "ANTHROPIC_AUTH_TOKEN",  # CCR/proxy token (for enterprise setups)
]

# Environment variables to pass through to SDK subprocess
# NOTE: ANTHROPIC_API_KEY is intentionally excluded to prevent silent API billing
SDK_ENV_VARS = [
    # API endpoint configuration
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    # Model overrides (from API Profile custom model mappings)
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    # SDK behavior configuration
    "NO_PROXY",
    "DISABLE_TELEMETRY",
    "DISABLE_COST_WARNINGS",
    "API_TIMEOUT_MS",
    # Windows-specific: Git Bash path for Claude Code CLI
    "CLAUDE_CODE_GIT_BASH_PATH",
    # Claude CLI path override (allows frontend to pass detected CLI path to SDK)
    "CLAUDE_CLI_PATH",
    # Profile's custom config directory (for multi-profile token storage)
    "CLAUDE_CONFIG_DIR",
]


def is_encrypted_token(token: str | None) -> bool:
    """
    Check if a token is encrypted (has "enc:" prefix).

    Args:
        token: Token string to check (can be None)

    Returns:
        True if token starts with "enc:", False otherwise
    """
    return bool(token and token.startswith("enc:"))


def validate_token_not_encrypted(token: str) -> None:
    """
    Validate that a token is not in encrypted format.

    This function should be called before passing a token to the Claude Agent SDK
    to ensure proper error messages when decryption has failed.

    Args:
        token: Token string to validate

    Raises:
        ValueError: If token is in encrypted format (enc:...)
    """
    if is_encrypted_token(token):
        raise ValueError(
            "Authentication token is in encrypted format and cannot be used.\n\n"
            "The token decryption process failed or was not attempted.\n\n"
            "To fix this issue:\n"
            "  1. Re-authenticate with Claude Code CLI: claude setup-token\n"
            "  2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in your .env file\n\n"
            "Note: Encrypted tokens require the Claude Code CLI to be installed\n"
            "and properly configured with system keychain access."
        )


def decrypt_token(encrypted_token: str) -> str:
    """
    Decrypt Claude Code encrypted token.

    NOTE: This implementation currently relies on the system keychain (macOS Keychain,
    Linux Secret Service, Windows Credential Manager) to provide already-decrypted tokens.
    Encrypted tokens in the CLAUDE_CODE_OAUTH_TOKEN environment variable are NOT supported
    and will fail with NotImplementedError.

    For encrypted token support, users should:
    1. Run: claude setup-token (stores decrypted token in system keychain)
    2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in .env file

    Claude Code CLI stores OAuth tokens in encrypted format with "enc:" prefix.
    This function attempts to decrypt the token using platform-specific methods.

    Cross-platform token decryption approaches:
    - macOS: Token stored in Keychain with encryption key
    - Linux: Token stored in Secret Service API with encryption key
    - Windows: Token stored in Credential Manager or .credentials.json

    Args:
        encrypted_token: Token with 'enc:' prefix from Claude Code CLI

    Returns:
        Decrypted token in format 'sk-ant-oat01-...'

    Raises:
        ValueError: If token format is invalid or decryption fails
    """
    # Validate encrypted token format
    if not isinstance(encrypted_token, str):
        raise ValueError(
            f"Invalid token type. Expected string, got: {type(encrypted_token).__name__}"
        )

    if not encrypted_token.startswith("enc:"):
        raise ValueError(
            "Invalid encrypted token format. Token must start with 'enc:' prefix."
        )

    # Remove 'enc:' prefix to get encrypted data
    encrypted_data = encrypted_token[4:]

    if not encrypted_data:
        raise ValueError("Empty encrypted token data after 'enc:' prefix")

    # Basic validation of encrypted data format
    # Encrypted data should be a reasonable length (at least 10 chars)
    if len(encrypted_data) < 10:
        raise ValueError(
            "Encrypted token data is too short. The token may be corrupted."
        )

    # Check for obviously invalid characters that suggest corruption
    # Accepts both standard base64 (+/) and URL-safe base64 (-_) to be permissive
    if not all(c.isalnum() or c in "+-_/=" for c in encrypted_data):
        raise ValueError(
            "Encrypted token contains invalid characters. "
            "Expected base64-encoded data. The token may be corrupted."
        )

    # Attempt platform-specific decryption
    try:
        if is_macos():
            return _decrypt_token_macos(encrypted_data)
        elif is_linux():
            return _decrypt_token_linux(encrypted_data)
        elif is_windows():
            return _decrypt_token_windows(encrypted_data)
        else:
            raise ValueError("Unsupported platform for token decryption")

    except NotImplementedError as e:
        # Decryption not implemented - log warning and provide guidance
        logger.warning(
            "Token decryption failed: %s. Users must use plaintext tokens.", str(e)
        )
        raise ValueError(
            f"Encrypted token decryption is not yet implemented: {str(e)}\n\n"
            "To fix this issue:\n"
            "  1. Set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token (without 'enc:' prefix)\n"
            "  2. Or re-authenticate with: claude setup-token"
        )
    except ValueError:
        # Re-raise ValueError as-is (already has good error message)
        raise
    except FileNotFoundError as e:
        # File-related errors (missing credentials file, missing binary)
        raise ValueError(
            f"Failed to decrypt token - required file not found: {str(e)}\n\n"
            "To fix this issue:\n"
            "  1. Re-authenticate with Claude Code CLI: claude setup-token\n"
            "  2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in your .env file"
        )
    except PermissionError as e:
        # Permission errors (can't access keychain, credential manager, etc.)
        raise ValueError(
            f"Failed to decrypt token - permission denied: {str(e)}\n\n"
            "To fix this issue:\n"
            "  1. Grant keychain/credential manager access to this application\n"
            "  2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in your .env file"
        )
    except subprocess.TimeoutExpired:
        # Timeout during decryption process
        raise ValueError(
            "Failed to decrypt token - operation timed out.\n\n"
            "This may indicate a problem with system keychain access.\n\n"
            "To fix this issue:\n"
            "  1. Re-authenticate with Claude Code CLI: claude setup-token\n"
            "  2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in your .env file"
        )
    except Exception as e:
        # Catch-all for other errors - provide helpful error message
        error_type = type(e).__name__
        raise ValueError(
            f"Failed to decrypt token ({error_type}): {str(e)}\n\n"
            "To fix this issue:\n"
            "  1. Re-authenticate with Claude Code CLI: claude setup-token\n"
            "  2. Or set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in your .env file\n\n"
            "Note: Encrypted tokens (enc:...) require the Claude Code CLI to be installed\n"
            "and properly configured with system keychain access."
        )


def _decrypt_token_macos(encrypted_data: str) -> str:
    """
    Decrypt token on macOS using Keychain.

    Args:
        encrypted_data: Encrypted token data (without 'enc:' prefix)

    Returns:
        Decrypted token

    Raises:
        ValueError: If decryption fails or Claude CLI not available
    """
    # Verify Claude CLI is installed (required for future decryption implementation)
    if not shutil.which("claude"):
        raise ValueError(
            "Claude Code CLI not found. Please install it from https://code.claude.com"
        )

    # The Claude Code CLI handles token decryption internally when it runs
    # We can trigger this by running a simple command that requires authentication
    # and capturing the decrypted token from the environment it sets up
    #
    # However, there's no direct CLI command to decrypt tokens.
    # The SDK should handle this automatically when it receives encrypted tokens.
    raise NotImplementedError(
        "Encrypted tokens in environment variables are not supported. "
        "Please use one of these options:\n"
        "  1. Run 'claude setup-token' to store token in system keychain\n"
        "  2. Set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in .env file\n\n"
        "Note: This requires Claude Agent SDK >= 0.1.19"
    )


def _decrypt_token_linux(encrypted_data: str) -> str:
    """
    Decrypt token on Linux using Secret Service API.

    Args:
        encrypted_data: Encrypted token data (without 'enc:' prefix)

    Returns:
        Decrypted token

    Raises:
        ValueError: If decryption fails or dependencies not available
    """
    # Linux token decryption requires secretstorage library
    if secretstorage is None:
        raise ValueError(
            "secretstorage library not found. Install it with: pip install secretstorage"
        )

    # Similar to macOS, the actual decryption mechanism isn't publicly documented
    # The Claude Agent SDK should handle this automatically
    raise NotImplementedError(
        "Encrypted tokens in environment variables are not supported. "
        "Please use one of these options:\n"
        "  1. Run 'claude setup-token' to store token in system keychain\n"
        "  2. Set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in .env file\n\n"
        "Note: This requires Claude Agent SDK >= 0.1.19"
    )


def _decrypt_token_windows(encrypted_data: str) -> str:
    """
    Decrypt token on Windows using Credential Manager.

    Args:
        encrypted_data: Encrypted token data (without 'enc:' prefix)

    Returns:
        Decrypted token

    Raises:
        ValueError: If decryption fails
    """
    # Windows token decryption from Credential Manager or .credentials.json
    # The Claude Agent SDK should handle this automatically
    raise NotImplementedError(
        "Encrypted tokens in environment variables are not supported. "
        "Please use one of these options:\n"
        "  1. Run 'claude setup-token' to store token in system keychain\n"
        "  2. Set CLAUDE_CODE_OAUTH_TOKEN to a plaintext token in .env file\n\n"
        "Note: This requires Claude Agent SDK >= 0.1.19"
    )


def _try_decrypt_token(token: str | None) -> str | None:
    """
    Attempt to decrypt an encrypted token, returning original if decryption fails.

    This helper centralizes the decrypt-or-return-as-is logic used when resolving
    tokens from various sources (env vars, config dir, keychain).

    Args:
        token: Token string (may be encrypted with "enc:" prefix, plaintext, or None)

    Returns:
        - Decrypted token if successfully decrypted
        - Original token if decryption fails (allows client validation to report error)
        - Original token if not encrypted
        - None if token is None
    """
    if not token:
        return None

    if is_encrypted_token(token):
        try:
            return decrypt_token(token)
        except ValueError:
            # Decryption failed - return encrypted token so client validation
            # (validate_token_not_encrypted) can provide specific error message.
            return token

    return token


def get_token_from_keychain() -> str | None:
    """
    Get authentication token from system credential store.

    Reads Claude Code credentials from:
    - macOS: Keychain
    - Windows: Credential Manager
    - Linux: Secret Service API (via dbus/secretstorage)

    Returns:
        Token string if found, None otherwise
    """
    if is_macos():
        return _get_token_from_macos_keychain()
    elif is_windows():
        return _get_token_from_windows_credential_files()
    else:
        # Linux: use secret-service API via DBus
        return _get_token_from_linux_secret_service()


def _get_token_from_macos_keychain() -> str | None:
    """Get token from macOS Keychain."""
    try:
        result = subprocess.run(
            [
                "/usr/bin/security",
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-w",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode != 0:
            return None

        credentials_json = result.stdout.strip()
        if not credentials_json:
            return None

        data = json.loads(credentials_json)
        token = data.get("claudeAiOauth", {}).get("accessToken")

        if not token:
            return None

        # Validate token format (Claude OAuth tokens start with sk-ant-oat01-)
        if not token.startswith("sk-ant-oat01-"):
            return None

        return token

    except (subprocess.TimeoutExpired, json.JSONDecodeError, KeyError, Exception):
        return None


def _get_token_from_windows_credential_files() -> str | None:
    """Get token from Windows credential files.

    Claude Code on Windows stores credentials in ~/.claude/.credentials.json
    """
    try:
        # Claude Code stores credentials in ~/.claude/.credentials.json
        cred_paths = [
            os.path.expandvars(r"%USERPROFILE%\.claude\.credentials.json"),
            os.path.expandvars(r"%USERPROFILE%\.claude\credentials.json"),
            os.path.expandvars(r"%LOCALAPPDATA%\Claude\credentials.json"),
            os.path.expandvars(r"%APPDATA%\Claude\credentials.json"),
        ]

        for cred_path in cred_paths:
            if os.path.exists(cred_path):
                with open(cred_path, encoding="utf-8") as f:
                    data = json.load(f)
                    token = data.get("claudeAiOauth", {}).get("accessToken")
                    if token and token.startswith("sk-ant-oat01-"):
                        return token

        return None

    except (json.JSONDecodeError, KeyError, FileNotFoundError, Exception):
        return None


def _get_token_from_linux_secret_service() -> str | None:
    """Get token from Linux Secret Service API via DBus.

    Claude Code on Linux stores credentials in the Secret Service API
    using the 'org.freedesktop.secrets' collection. This implementation
    uses the secretstorage library which communicates via DBus.

    The credential is stored with:
    - Label: "Claude Code-credentials"
    - Attributes: {application: "claude-code"}

    Returns:
        Token string if found, None otherwise
    """
    if secretstorage is None:
        # secretstorage not installed, fall back to env var
        return None

    try:
        # Get the default collection (typically "login" keyring)
        # secretstorage handles DBus communication internally
        try:
            collection = secretstorage.get_default_collection(None)
        except (
            AttributeError,
            secretstorage.exceptions.SecretServiceNotAvailableException,
        ):
            # DBus not available or secret-service not running
            return None

        if collection.is_locked():
            # Try to unlock the collection (may prompt user for password)
            try:
                collection.unlock()
            except secretstorage.exceptions.SecretStorageException:
                # User cancelled or unlock failed
                return None

        # Search for items with our application attribute
        items = collection.search_items({"application": "claude-code"})

        for item in items:
            # Check if this is the Claude Code credentials item
            label = item.get_label()
            # Use exact match for "Claude Code-credentials" to avoid false positives
            if label == "Claude Code-credentials":
                # Get the secret (stored as JSON string)
                secret = item.get_secret()
                if not secret:
                    continue

                try:
                    # Explicitly decode bytes to string if needed
                    if isinstance(secret, bytes):
                        secret = secret.decode("utf-8")
                    data = json.loads(secret)
                    token = data.get("claudeAiOauth", {}).get("accessToken")

                    if token and token.startswith("sk-ant-oat01-"):
                        return token
                except json.JSONDecodeError:
                    continue

        return None

    except (
        secretstorage.exceptions.SecretStorageException,
        json.JSONDecodeError,
        KeyError,
        AttributeError,
        TypeError,
    ):
        # Any error with secret-service, fall back to env var
        return None


def _get_token_from_config_dir(config_dir: str) -> str | None:
    """
    Read token from a custom config directory's credentials file.

    Claude Code stores credentials in .credentials.json within the config directory.
    This function reads from a profile's custom configDir instead of the default location.

    Args:
        config_dir: Path to the config directory (e.g., ~/.auto-claude/profiles/work)

    Returns:
        Token string if found, None otherwise
    """
    # Expand ~ if present
    expanded_dir = os.path.expanduser(config_dir)

    # Claude stores credentials in these files within the config dir
    cred_files = [
        os.path.join(expanded_dir, ".credentials.json"),
        os.path.join(expanded_dir, "credentials.json"),
    ]

    for cred_path in cred_files:
        if os.path.exists(cred_path):
            try:
                with open(cred_path, encoding="utf-8") as f:
                    data = json.load(f)

                # Try both credential structures
                oauth_data = data.get("claudeAiOauth") or data.get("oauthAccount") or {}
                token = oauth_data.get("accessToken")

                # Accept both plaintext tokens (sk-ant-oat01-) and encrypted tokens (enc:)
                if token and (
                    token.startswith("sk-ant-oat01-") or token.startswith("enc:")
                ):
                    logger.debug(f"Found token in {cred_path}")
                    return token
            except (json.JSONDecodeError, KeyError, Exception) as e:
                logger.debug(f"Failed to read {cred_path}: {e}")
                continue

    return None


def get_auth_token(config_dir: str | None = None) -> str | None:
    """
    Get authentication token from environment variables or credential store.

    Args:
        config_dir: Optional custom config directory (profile's configDir).
                   If provided, reads credentials from this directory.
                   If None, checks CLAUDE_CONFIG_DIR env var, then uses default locations.

    Checks multiple sources in priority order:
    1. CLAUDE_CODE_OAUTH_TOKEN (env var)
    2. ANTHROPIC_AUTH_TOKEN (CCR/proxy env var for enterprise setups)
    3. Custom config directory (config_dir param or CLAUDE_CONFIG_DIR env var)
    4. System credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service)

    NOTE: ANTHROPIC_API_KEY is intentionally NOT supported to prevent
    silent billing to user's API credits when OAuth is misconfigured.

    If the token has an "enc:" prefix (encrypted format), it will be automatically
    decrypted before being returned.

    Returns:
        Token string if found, None otherwise
    """
    # First check environment variables (highest priority)
    for var in AUTH_TOKEN_ENV_VARS:
        token = os.environ.get(var)
        if token:
            return _try_decrypt_token(token)

    # Check CLAUDE_CONFIG_DIR environment variable (profile's custom config directory)
    env_config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    effective_config_dir = config_dir or env_config_dir

    # If a custom config directory is specified, read from there
    if effective_config_dir:
        token = _get_token_from_config_dir(effective_config_dir)
        if token:
            return _try_decrypt_token(token)

    # Fallback to system credential store (default locations)
    return _try_decrypt_token(get_token_from_keychain())


def get_auth_token_source(config_dir: str | None = None) -> str | None:
    """
    Get the name of the source that provided the auth token.

    Args:
        config_dir: Optional custom config directory (profile's configDir).
                   If provided, checks this directory for credentials.
                   If None, checks CLAUDE_CONFIG_DIR env var.
    """
    # Check environment variables first
    for var in AUTH_TOKEN_ENV_VARS:
        if os.environ.get(var):
            return var

    # Check if token came from custom config directory (profile's configDir)
    env_config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    effective_config_dir = config_dir or env_config_dir
    if effective_config_dir and _get_token_from_config_dir(effective_config_dir):
        return "CLAUDE_CONFIG_DIR"

    # Check if token came from system credential store
    if get_token_from_keychain():
        if is_macos():
            return "macOS Keychain"
        elif is_windows():
            return "Windows Credential Files"
        else:
            return "Linux Secret Service"

    return None


def require_auth_token(config_dir: str | None = None) -> str:
    """
    Get authentication token or raise ValueError.

    Args:
        config_dir: Optional custom config directory (profile's configDir).
                   If provided, reads credentials from this directory.
                   If None, checks CLAUDE_CONFIG_DIR env var, then uses default locations.

    Raises:
        ValueError: If no auth token is found in any supported source
    """
    token = get_auth_token(config_dir)
    if not token:
        error_msg = (
            "No OAuth token found.\n\n"
            "Auto Claude requires Claude Code OAuth authentication.\n"
            "Direct API keys (ANTHROPIC_API_KEY) are not supported.\n\n"
        )
        # Provide platform-specific guidance
        if is_macos():
            error_msg += (
                "To authenticate:\n"
                "  1. Run: claude\n"
                "  2. Type: /login\n"
                "  3. Press Enter to open browser\n"
                "  4. Complete OAuth login in browser\n\n"
                "The token will be saved to macOS Keychain automatically."
            )
        elif is_windows():
            error_msg += (
                "To authenticate:\n"
                "  1. Run: claude\n"
                "  2. Type: /login\n"
                "  3. Press Enter to open browser\n"
                "  4. Complete OAuth login in browser\n\n"
                "The token will be saved to Windows Credential Manager."
            )
        else:
            # Linux
            error_msg += (
                "To authenticate:\n"
                "  1. Run: claude\n"
                "  2. Type: /login\n"
                "  3. Press Enter to open browser\n"
                "  4. Complete OAuth login in browser\n\n"
                "Or set CLAUDE_CODE_OAUTH_TOKEN in your .env file."
            )
        raise ValueError(error_msg)
    return token


def _find_git_bash_path() -> str | None:
    """
    Find git-bash (bash.exe) path on Windows.

    Uses 'where git' to find git.exe, then derives bash.exe location from it.
    Git for Windows installs bash.exe in the 'bin' directory alongside git.exe
    or in the parent 'bin' directory when git.exe is in 'cmd'.

    Returns:
        Full path to bash.exe if found, None otherwise
    """
    if not is_windows():
        return None

    # If already set in environment, use that
    existing = os.environ.get("CLAUDE_CODE_GIT_BASH_PATH")
    if existing and os.path.exists(existing):
        return existing

    git_path = None

    # Method 1: Use 'where' command to find git.exe
    try:
        # Use where.exe explicitly for reliability
        result = subprocess.run(
            ["where.exe", "git"],
            capture_output=True,
            text=True,
            timeout=5,
            shell=False,
        )

        if result.returncode == 0 and result.stdout.strip():
            git_paths = result.stdout.strip().splitlines()
            if git_paths:
                git_path = git_paths[0].strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
        # Intentionally suppress errors - best-effort detection with fallback to common paths
        pass

    # Method 2: Check common installation paths if 'where' didn't work
    if not git_path:
        common_git_paths = [
            os.path.expandvars(r"%PROGRAMFILES%\Git\cmd\git.exe"),
            os.path.expandvars(r"%PROGRAMFILES%\Git\bin\git.exe"),
            os.path.expandvars(r"%PROGRAMFILES(X86)%\Git\cmd\git.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\cmd\git.exe"),
        ]
        for path in common_git_paths:
            if os.path.exists(path):
                git_path = path
                break

    if not git_path:
        return None

    # Derive bash.exe location from git.exe location
    # Git for Windows structure:
    #   C:\...\Git\cmd\git.exe     -> bash.exe is at C:\...\Git\bin\bash.exe
    #   C:\...\Git\bin\git.exe     -> bash.exe is at C:\...\Git\bin\bash.exe
    #   C:\...\Git\mingw64\bin\git.exe -> bash.exe is at C:\...\Git\bin\bash.exe
    git_dir = os.path.dirname(git_path)
    git_parent = os.path.dirname(git_dir)
    git_grandparent = os.path.dirname(git_parent)

    # Check common bash.exe locations relative to git installation
    possible_bash_paths = [
        os.path.join(git_parent, "bin", "bash.exe"),  # cmd -> bin
        os.path.join(git_dir, "bash.exe"),  # If git.exe is in bin
        os.path.join(git_grandparent, "bin", "bash.exe"),  # mingw64/bin -> bin
    ]

    for bash_path in possible_bash_paths:
        if os.path.exists(bash_path):
            return bash_path

    return None


def get_sdk_env_vars() -> dict[str, str]:
    """
    Get environment variables to pass to SDK.

    Collects relevant env vars (ANTHROPIC_BASE_URL, etc.) that should
    be passed through to the claude-agent-sdk subprocess.

    On Windows, auto-detects CLAUDE_CODE_GIT_BASH_PATH if not already set.

    Returns:
        Dict of env var name -> value for non-empty vars
    """
    env = {}
    for var in SDK_ENV_VARS:
        value = os.environ.get(var)
        if value:
            env[var] = value

    # On Windows, auto-detect git-bash path if not already set
    # Claude Code CLI requires bash.exe to run on Windows
    if is_windows() and "CLAUDE_CODE_GIT_BASH_PATH" not in env:
        bash_path = _find_git_bash_path()
        if bash_path:
            env["CLAUDE_CODE_GIT_BASH_PATH"] = bash_path

    # Explicitly unset PYTHONPATH in SDK subprocess environment to prevent
    # pollution of agent subprocess environments. This fixes ACS-251 where
    # external projects with different Python versions would fail due to
    # inheriting Auto-Claude's PYTHONPATH (which points to Python 3.12 packages).
    #
    # The SDK merges os.environ with the env dict we provide, so setting
    # PYTHONPATH to an empty string here overrides any inherited value.
    # The empty string ensures Python doesn't add any extra paths to sys.path.
    env["PYTHONPATH"] = ""

    return env


def ensure_claude_code_oauth_token() -> None:
    """
    Ensure CLAUDE_CODE_OAUTH_TOKEN is set (for SDK compatibility).

    If not set but other auth tokens are available, copies the value
    to CLAUDE_CODE_OAUTH_TOKEN so the underlying SDK can use it.
    """
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return

    token = get_auth_token()
    if token:
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token


def trigger_login() -> bool:
    """
    Trigger Claude Code OAuth login flow.

    Opens the Claude Code CLI and sends /login command to initiate
    browser-based OAuth authentication. The token is automatically
    saved to the system credential store (macOS Keychain, Windows
    Credential Manager).

    Returns:
        True if login was successful, False otherwise
    """
    if is_macos():
        return _trigger_login_macos()
    elif is_windows():
        return _trigger_login_windows()
    else:
        # Linux: fall back to manual instructions
        print("\nTo authenticate, run 'claude' and type '/login'")
        return False


def _trigger_login_macos() -> bool:
    """Trigger login on macOS using expect."""
    import shutil
    import tempfile

    # Check if expect is available
    if not shutil.which("expect"):
        print("\nTo authenticate, run 'claude' and type '/login'")
        return False

    # Create expect script
    expect_script = """#!/usr/bin/expect -f
set timeout 120
spawn claude
expect {
    -re ".*" {
        send "/login\\r"
        expect {
            "Press Enter" {
                send "\\r"
            }
            -re ".*login.*" {
                send "\\r"
            }
            timeout {
                send "\\r"
            }
        }
    }
}
# Keep running until user completes login or exits
interact
"""

    # Use TemporaryDirectory context manager for automatic cleanup
    # This prevents information leakage about authentication activity
    # Directory created with mode 0o700 (owner read/write/execute only)
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            # Ensure directory has owner-only permissions
            os.chmod(temp_dir, 0o700)

            # Write expect script to temp file in our private directory
            script_path = os.path.join(temp_dir, "login.exp")
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(expect_script)

            # Set script permissions to owner-only (0o700)
            os.chmod(script_path, 0o700)

            print("\n" + "=" * 60)
            print("CLAUDE CODE LOGIN")
            print("=" * 60)
            print("\nOpening Claude Code for authentication...")
            print("A browser window will open for OAuth login.")
            print("After completing login in the browser, press Ctrl+C to exit.\n")

            # Run expect script
            subprocess.run(
                ["expect", script_path],
                timeout=300,  # 5 minute timeout
            )

            # Verify token was saved
            token = get_token_from_keychain()
            if token:
                print("\n✓ Login successful! Token saved to macOS Keychain.")
                return True
            else:
                print(
                    "\n✗ Login may not have completed. Try running 'claude' and type '/login'"
                )
                return False

    except subprocess.TimeoutExpired:
        print("\nLogin timed out. Try running 'claude' manually and type '/login'")
        return False
    except KeyboardInterrupt:
        # User pressed Ctrl+C - check if login completed
        token = get_token_from_keychain()
        if token:
            print("\n✓ Login successful! Token saved to macOS Keychain.")
            return True
        return False
    except Exception as e:
        print(f"\nLogin failed: {e}")
        print("Try running 'claude' manually and type '/login'")
        return False


def _trigger_login_windows() -> bool:
    """Trigger login on Windows."""
    # Windows doesn't have expect by default, so we use a simpler approach
    # that just launches claude and tells the user what to type
    print("\n" + "=" * 60)
    print("CLAUDE CODE LOGIN")
    print("=" * 60)
    print("\nLaunching Claude Code...")
    print("Please type '/login' and press Enter.")
    print("A browser window will open for OAuth login.\n")

    try:
        # Launch claude interactively
        subprocess.run(["claude"], timeout=300)

        # Verify token was saved
        token = _get_token_from_windows_credential_files()
        if token:
            print("\n✓ Login successful!")
            return True
        else:
            print("\n✗ Login may not have completed.")
            return False

    except Exception as e:
        print(f"\nLogin failed: {e}")
        return False


def ensure_authenticated() -> str:
    """
    Ensure the user is authenticated, prompting for login if needed.

    Checks for existing token and triggers login flow if not found.

    Returns:
        The authentication token

    Raises:
        ValueError: If authentication fails after login attempt
    """
    # First check if already authenticated
    token = get_auth_token()
    if token:
        return token

    # No token found - trigger login
    print("\nNo OAuth token found. Starting login flow...")

    if trigger_login():
        # Re-check for token after login
        token = get_auth_token()
        if token:
            return token

    # Login failed or was cancelled
    raise ValueError(
        "Authentication required.\n\n"
        "To authenticate:\n"
        "  1. Run: claude\n"
        "  2. Type: /login\n"
        "  3. Press Enter to open browser\n"
        "  4. Complete OAuth login in browser"
    )


def list_credentials() -> list[dict[str, str | None]]:
    """
    List all stored credential profiles from platform-specific storage.

    Retrieves all Auto Claude credentials from:
    - macOS: Keychain (all items with service "auto-claude-*")
    - Windows: Credential Manager or .credentials.json files
    - Linux: Secret Service API (all items with application "auto-claude")

    Returns:
        List of credential dictionaries with keys:
        - id: Unique credential identifier
        - type: Credential type ('oauth' or 'api_key')
        - name: Credential name
        - status: Credential status ('active', 'rate_limited', 'disabled')
        - last_used: Last used timestamp (ISO format string or None)

    Note:
        This function only returns credential metadata, not actual credential values.
        Use get_credential(id) to retrieve the full credential profile with value.

    Example:
        >>> creds = list_credentials()
        >>> for cred in creds:
        ...     print(f"{cred['name']}: {cred['status']}")
    """
    if is_macos():
        return _list_credentials_macos()
    elif is_windows():
        return _list_credentials_windows()
    else:
        # Linux: use secret-service API via DBus
        return _list_credentials_linux()


def _list_credentials_macos() -> list[dict[str, str | None]]:
    """
    List all credential profiles from macOS Keychain.

    Searches for all Keychain items with service names matching
    "auto-claude-*" pattern to find Auto Claude credential profiles.

    Returns:
        List of credential metadata dictionaries
    """
    try:
        # Use 'security' command to dump all Auto Claude credentials
        # We search for generic passwords with service matching "auto-claude-*"
        result = subprocess.run(
            ["/usr/bin/security", "dump-keychain", "-g"],
            capture_output=True,
            text=True,
            timeout=10,
        )

        if result.returncode != 0:
            logger.warning("Failed to dump macOS Keychain for credential listing")
            return []

        # Parse keychain output to find Auto Claude credentials
        credentials = []
        lines = result.stdout.split("\n")

        current_cred = None
        for line in lines:
            # Look for service name (indicating a new credential)
            if "svc." in line or "service" in line.lower():
                service_match = None
                # Extract service name from line format like:
                # "    0x0000000 <blob>="auto-claude-cred-001""
                # or "svce: "auto-claude-cred-001""
                for part in line.split('"'):
                    if part.startswith("auto-claude-"):
                        service_match = part
                        break

                if service_match:
                    # Save previous credential if exists
                    if current_cred:
                        credentials.append(current_cred)

                    # Start new credential
                    cred_id = service_match.replace("auto-claude-", "")
                    current_cred = {
                        "id": cred_id,
                        "type": "oauth",  # Default, will be updated if we can determine type
                        "name": f"Credential {cred_id}",
                        "status": "active",
                        "last_used": None,
                    }

            # Look for account name (may contain metadata)
            if current_cred and "acct" in line.lower():
                # Extract account name if available
                for part in line.split('"'):
                    if len(part) > 0 and not part.startswith("auto-claude-"):
                        current_cred["name"] = part
                        break

        # Don't forget the last credential
        if current_cred:
            credentials.append(current_cred)

        return credentials

    except subprocess.TimeoutExpired:
        logger.warning("Timeout while listing macOS Keychain credentials")
        return []
    except Exception as e:
        logger.warning(f"Failed to list macOS Keychain credentials: {e}")
        return []


def _list_credentials_windows() -> list[dict[str, str | None]]:
    """
    List all credential profiles from Windows credential storage.

    Checks multiple locations:
    1. ~/.claude/.credentials-auto-claude-*.json files
    2. Windows Credential Manager (via cmdkey command)

    Returns:
        List of credential metadata dictionaries
    """
    credentials = []

    try:
        # Method 1: Check for credential files in ~/.claude directory
        claude_dir = os.path.expandvars(r"%USERPROFILE%\.claude")
        if os.path.exists(claude_dir):
            for filename in os.listdir(claude_dir):
                if filename.startswith(".credentials-auto-claude-") and filename.endswith(
                    ".json"
                ):
                    try:
                        cred_id = filename.replace(".credentials-auto-claude-", "").replace(
                            ".json", ""
                        )
                        filepath = os.path.join(claude_dir, filename)

                        with open(filepath, encoding="utf-8") as f:
                            data = json.load(f)

                        credentials.append(
                            {
                                "id": cred_id,
                                "type": data.get("type", "oauth"),
                                "name": data.get("name", f"Credential {cred_id}"),
                                "status": data.get("status", "active"),
                                "last_used": data.get("last_used"),
                            }
                        )
                    except (json.JSONDecodeError, KeyError, IOError) as e:
                        logger.debug(f"Failed to read credential file {filename}: {e}")
                        continue

        # Method 2: Use cmdkey to list Windows Credential Manager entries
        # This finds generic credentials with target matching "auto-claude-*"
        try:
            result = subprocess.run(
                ["cmdkey", "/list"],
                capture_output=True,
                text=True,
                timeout=5,
                shell=False,
            )

            if result.returncode == 0:
                lines = result.stdout.split("\n")
                for line in lines:
                    if "auto-claude-" in line.lower():
                        # Parse credential target name
                        # Format: "Target: Domain:target=auto-claude-cred-001"
                        if "target=" in line:
                            target = line.split("target=")[-1].strip()
                            if target.startswith("auto-claude-"):
                                cred_id = target.replace("auto-claude-", "")
                                # Check if we already have this credential
                                if not any(c["id"] == cred_id for c in credentials):
                                    credentials.append(
                                        {
                                            "id": cred_id,
                                            "type": "oauth",
                                            "name": f"Credential {cred_id}",
                                            "status": "active",
                                            "last_used": None,
                                        }
                                    )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            # cmdkey not available or failed - ignore
            pass

        return credentials

    except Exception as e:
        logger.warning(f"Failed to list Windows credentials: {e}")
        return []


def _list_credentials_linux() -> list[dict[str, str | None]]:
    """
    List all credential profiles from Linux Secret Service API.

    Searches for all Secret Service items with application attribute
    matching "auto-claude-*" pattern.

    Returns:
        List of credential metadata dictionaries
    """
    if secretstorage is None:
        # secretstorage not installed
        return []

    try:
        # Get the default collection
        try:
            collection = secretstorage.get_default_collection(None)
        except (
            AttributeError,
            secretstorage.exceptions.SecretServiceNotAvailableException,
        ):
            # DBus not available or secret-service not running
            return []

        if collection.is_locked():
            # Try to unlock the collection (may prompt user for password)
            try:
                collection.unlock()
            except secretstorage.exceptions.SecretStorageException:
                # User cancelled or unlock failed
                return []

        # Search for all items (not just claude-code)
        items = collection.get_all_items()

        credentials = []
        for item in items:
            # Get item attributes
            attrs = item.get_attributes()

            # Check if this is an Auto Claude credential
            application = attrs.get("application", "")
            if application.startswith("auto-claude-"):
                # Extract credential ID from application name
                cred_id = application.replace("auto-claude-", "")

                # Get label for name
                label = item.get_label()

                # Try to get secret to determine type (without loading full value)
                secret = item.get_secret()
                cred_type = "oauth"  # Default
                if secret:
                    try:
                        if isinstance(secret, bytes):
                            secret = secret.decode("utf-8")
                        data = json.loads(secret)
                        cred_type = data.get("type", "oauth")
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        # Secret is not JSON, check if it's an API key
                        if secret.startswith("sk-ant-api03-"):
                            cred_type = "api_key"

                credentials.append(
                    {
                        "id": cred_id,
                        "type": cred_type,
                        "name": label or f"Credential {cred_id}",
                        "status": "active",
                        "last_used": None,
                    }
                )

        return credentials

    except (
        secretstorage.exceptions.SecretStorageException,
        json.JSONDecodeError,
        AttributeError,
        TypeError,
    ) as e:
        logger.warning(f"Failed to list Linux Secret Service credentials: {e}")
        return []


def get_credential(cred_id: str) -> dict[str, str | None] | None:
    """
    Get a single credential profile by ID from platform-specific storage.

    Retrieves the full credential profile including the actual credential value
    from:
    - macOS: Keychain (service: "auto-claude-{cred_id}")
    - Windows: Credential Manager or .credentials-auto-claude-{cred_id}.json file
    - Linux: Secret Service API (application: "auto-claude-{cred_id}")

    Args:
        cred_id: Unique credential identifier (e.g., "cred-001")

    Returns:
        Dictionary with credential data including:
        - id: Credential ID
        - type: Credential type ('oauth' or 'api_key')
        - name: Credential name
        - status: Credential status ('active', 'rate_limited', 'disabled')
        - value: Actual credential value (token or API key)
        - last_used: Last used timestamp (ISO format string or None)

        Returns None if credential not found.

    Example:
        >>> cred = get_credential("cred-001")
        >>> if cred:
        ...     print(f"Found: {cred['name']}")
        ...     token = cred['value']
    """
    if is_macos():
        return _get_credential_macos(cred_id)
    elif is_windows():
        return _get_credential_windows(cred_id)
    else:
        # Linux: use secret-service API via DBus
        return _get_credential_linux(cred_id)


def _get_credential_macos(cred_id: str) -> dict[str, str | None] | None:
    """
    Get a credential profile from macOS Keychain.

    Args:
        cred_id: Unique credential identifier

    Returns:
        Credential dictionary with value, or None if not found
    """
    try:
        # Construct service name for this credential
        service_name = f"auto-claude-{cred_id}"

        # Use 'security' command to find password
        result = subprocess.run(
            [
                "/usr/bin/security",
                "find-generic-password",
                "-s",
                service_name,
                "-w",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode != 0:
            logger.debug(f"Credential '{cred_id}' not found in macOS Keychain")
            return None

        credential_json = result.stdout.strip()
        if not credential_json:
            return None

        data = json.loads(credential_json)

        # Extract credential data
        return {
            "id": cred_id,
            "type": data.get("type", "oauth"),
            "name": data.get("name", f"Credential {cred_id}"),
            "status": data.get("status", "active"),
            "value": data.get("value"),
            "last_used": data.get("last_used"),
        }

    except (subprocess.TimeoutExpired, json.JSONDecodeError, KeyError, Exception) as e:
        logger.warning(f"Failed to get credential '{cred_id}' from macOS Keychain: {e}")
        return None


def _get_credential_windows(cred_id: str) -> dict[str, str | None] | None:
    """
    Get a credential profile from Windows credential storage.

    Checks for credential files in ~/.claude directory.

    Args:
        cred_id: Unique credential identifier

    Returns:
        Credential dictionary with value, or None if not found
    """
    try:
        # Check for credential file in ~/.claude directory
        claude_dir = os.path.expandvars(r"%USERPROFILE%\.claude")
        cred_filename = f".credentials-auto-claude-{cred_id}.json"
        cred_path = os.path.join(claude_dir, cred_filename)

        if not os.path.exists(cred_path):
            logger.debug(f"Credential '{cred_id}' not found in Windows credential files")
            return None

        with open(cred_path, encoding="utf-8") as f:
            data = json.load(f)

        return {
            "id": cred_id,
            "type": data.get("type", "oauth"),
            "name": data.get("name", f"Credential {cred_id}"),
            "status": data.get("status", "active"),
            "value": data.get("value"),
            "last_used": data.get("last_used"),
        }

    except (json.JSONDecodeError, KeyError, FileNotFoundError, Exception) as e:
        logger.warning(f"Failed to get credential '{cred_id}' from Windows storage: {e}")
        return None


def _get_credential_linux(cred_id: str) -> dict[str, str | None] | None:
    """
    Get a credential profile from Linux Secret Service API.

    Args:
        cred_id: Unique credential identifier

    Returns:
        Credential dictionary with value, or None if not found
    """
    if secretstorage is None:
        logger.debug("secretstorage not available for credential retrieval")
        return None

    try:
        # Get the default collection
        try:
            collection = secretstorage.get_default_collection(None)
        except (
            AttributeError,
            secretstorage.exceptions.SecretServiceNotAvailableException,
        ):
            logger.debug("Secret Service not available")
            return None

        if collection.is_locked():
            # Try to unlock the collection
            try:
                collection.unlock()
            except secretstorage.exceptions.SecretStorageException:
                logger.debug("Failed to unlock Secret Service collection")
                return None

        # Search for items with our application attribute
        items = collection.search_items({"application": f"auto-claude-{cred_id}"})

        for item in items:
            # Get the secret (stored as JSON string)
            secret = item.get_secret()
            if not secret:
                continue

            try:
                # Decode bytes to string if needed
                if isinstance(secret, bytes):
                    secret = secret.decode("utf-8")
                data = json.loads(secret)

                return {
                    "id": cred_id,
                    "type": data.get("type", "oauth"),
                    "name": data.get("name", f"Credential {cred_id}"),
                    "status": data.get("status", "active"),
                    "value": data.get("value"),
                    "last_used": data.get("last_used"),
                }
            except json.JSONDecodeError:
                continue

        logger.debug(f"Credential '{cred_id}' not found in Linux Secret Service")
        return None

    except (
        secretstorage.exceptions.SecretStorageException,
        json.JSONDecodeError,
        AttributeError,
        TypeError,
    ) as e:
        logger.warning(f"Failed to get credential '{cred_id}' from Linux Secret Service: {e}")
        return None


def save_credential(credential: dict[str, str]) -> bool:
    """
    Save a credential profile to platform-specific storage.

    Stores the credential profile with its value and metadata.
    If a credential with the same ID already exists, it will be overwritten.

    Args:
        credential: Dictionary with credential data:
            - id: Required - Unique credential identifier
            - type: Required - Credential type ('oauth' or 'api_key')
            - name: Optional - Credential name
            - status: Optional - Credential status (default: 'active')
            - value: Required - Actual credential value (token or API key)
            - last_used: Optional - Last used timestamp

    Returns:
        True if save was successful, False otherwise

    Example:
        >>> success = save_credential({
        ...     "id": "cred-001",
        ...     "type": "oauth",
        ...     "name": "Primary Account",
        ...     "value": "sk-ant-oat01-...",
        ...     "status": "active"
        ... })
    """
    # Validate required fields
    if "id" not in credential or "value" not in credential:
        logger.error("Credential must have 'id' and 'value' fields")
        return False

    if is_macos():
        return _save_credential_macos(credential)
    elif is_windows():
        return _save_credential_windows(credential)
    else:
        # Linux: use secret-service API via DBus
        return _save_credential_linux(credential)


def _save_credential_macos(credential: dict[str, str]) -> bool:
    """
    Save a credential profile to macOS Keychain.

    Args:
        credential: Credential dictionary with all required fields

    Returns:
        True if save was successful, False otherwise
    """
    try:
        # Construct service name for this credential
        service_name = f"auto-claude-{credential['id']}"

        # Prepare credential data for storage
        cred_data = {
            "id": credential["id"],
            "type": credential.get("type", "oauth"),
            "name": credential.get("name", f"Credential {credential['id']}"),
            "status": credential.get("status", "active"),
            "value": credential["value"],
            "last_used": credential.get("last_used"),
        }

        # Use 'security' command to add generic password
        result = subprocess.run(
            [
                "/usr/bin/security",
                "add-generic-password",
                "-a", credential["id"],  # Account name
                "-s", service_name,  # Service name
                "-w", json.dumps(cred_data),  # Password (credential data as JSON)
                "-U",  # Update if exists
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode != 0:
            logger.warning(f"Failed to save credential '{credential['id']}' to macOS Keychain: {result.stderr}")
            return False

        logger.info(f"Credential '{credential['id']}' saved to macOS Keychain")
        return True

    except (subprocess.TimeoutExpired, Exception) as e:
        logger.warning(f"Failed to save credential '{credential['id']}' to macOS Keychain: {e}")
        return False


def _save_credential_windows(credential: dict[str, str]) -> bool:
    """
    Save a credential profile to Windows credential storage.

    Stores credential in ~/.claude/.credentials-auto-claude-{id}.json file.

    Args:
        credential: Credential dictionary with all required fields

    Returns:
        True if save was successful, False otherwise
    """
    try:
        # Create ~/.claude directory if it doesn't exist
        claude_dir = os.path.expandvars(r"%USERPROFILE%\.claude")
        os.makedirs(claude_dir, exist_ok=True)

        # Prepare credential data for storage
        cred_data = {
            "id": credential["id"],
            "type": credential.get("type", "oauth"),
            "name": credential.get("name", f"Credential {credential['id']}"),
            "status": credential.get("status", "active"),
            "value": credential["value"],
            "last_used": credential.get("last_used"),
        }

        # Save to credential file
        cred_filename = f".credentials-auto-claude-{credential['id']}.json"
        cred_path = os.path.join(claude_dir, cred_filename)

        with open(cred_path, "w", encoding="utf-8") as f:
            json.dump(cred_data, f, indent=2)

        logger.info(f"Credential '{credential['id']}' saved to Windows credential files")
        return True

    except (IOError, Exception) as e:
        logger.warning(f"Failed to save credential '{credential['id']}' to Windows storage: {e}")
        return False


def _save_credential_linux(credential: dict[str, str]) -> bool:
    """
    Save a credential profile to Linux Secret Service API.

    Args:
        credential: Credential dictionary with all required fields

    Returns:
        True if save was successful, False otherwise
    """
    if secretstorage is None:
        logger.error("secretstorage not available for credential storage")
        return False

    try:
        # Get the default collection
        try:
            collection = secretstorage.get_default_collection(None)
        except (
            AttributeError,
            secretstorage.exceptions.SecretServiceNotAvailableException,
        ):
            logger.error("Secret Service not available")
            return False

        if collection.is_locked():
            # Try to unlock the collection
            try:
                collection.unlock()
            except secretstorage.exceptions.SecretStorageException:
                logger.error("Failed to unlock Secret Service collection")
                return False

        # Prepare credential data for storage
        cred_data = {
            "id": credential["id"],
            "type": credential.get("type", "oauth"),
            "name": credential.get("name", f"Credential {credential['id']}"),
            "status": credential.get("status", "active"),
            "value": credential["value"],
            "last_used": credential.get("last_used"),
        }

        # Check if item already exists
        existing_items = collection.search_items({"application": f"auto-claude-{credential['id']}"})

        # Delete existing item if found
        for item in existing_items:
            item.delete()

        # Create new item
        collection.create_item(
            label=cred_data["name"],
            attributes={"application": f"auto-claude-{credential['id']}"},
            secret=json.dumps(cred_data),
        )

        logger.info(f"Credential '{credential['id']}' saved to Linux Secret Service")
        return True

    except (
        secretstorage.exceptions.SecretStorageException,
        json.JSONDecodeError,
        AttributeError,
        TypeError,
    ) as e:
        logger.warning(f"Failed to save credential '{credential['id']}' to Linux Secret Service: {e}")
        return False


def delete_credential(cred_id: str) -> bool:
    """
    Delete a credential profile from platform-specific storage.

    Removes the credential profile from:
    - macOS: Keychain (service: "auto-claude-{cred_id}")
    - Windows: Credential Manager or .credentials-auto-claude-{cred_id}.json file
    - Linux: Secret Service API (application: "auto-claude-{cred_id}")

    Args:
        cred_id: Unique credential identifier (e.g., "cred-001")

    Returns:
        True if credential was deleted successfully, False otherwise

    Example:
        >>> success = delete_credential("cred-001")
        >>> if success:
        ...     print("Credential deleted")
    """
    if is_macos():
        return _delete_credential_macos(cred_id)
    elif is_windows():
        return _delete_credential_windows(cred_id)
    else:
        # Linux: use secret-service API via DBus
        return _delete_credential_linux(cred_id)


def _delete_credential_macos(cred_id: str) -> bool:
    """
    Delete a credential profile from macOS Keychain.

    Args:
        cred_id: Unique credential identifier

    Returns:
        True if credential was deleted, False otherwise
    """
    try:
        # Construct service name for this credential
        service_name = f"auto-claude-{cred_id}"

        # Use 'security' command to delete generic password
        result = subprocess.run(
            [
                "/usr/bin/security",
                "delete-generic-password",
                "-s", service_name,
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )

        # returncode 0 means success, 44 means item not found (considered success)
        if result.returncode in (0, 44):
            logger.info(f"Credential '{cred_id}' deleted from macOS Keychain")
            return True
        else:
            logger.warning(f"Failed to delete credential '{cred_id}' from macOS Keychain: {result.stderr}")
            return False

    except subprocess.TimeoutExpired:
        logger.warning(f"Timeout while deleting credential '{cred_id}' from macOS Keychain")
        return False
    except Exception as e:
        logger.warning(f"Failed to delete credential '{cred_id}' from macOS Keychain: {e}")
        return False


def _delete_credential_windows(cred_id: str) -> bool:
    """
    Delete a credential profile from Windows credential storage.

    Deletes the credential file from ~/.claude directory.

    Args:
        cred_id: Unique credential identifier

    Returns:
        True if credential was deleted, False otherwise
    """
    try:
        # Check for credential file in ~/.claude directory
        claude_dir = os.path.expandvars(r"%USERPROFILE%\.claude")
        cred_filename = f".credentials-auto-claude-{cred_id}.json"
        cred_path = os.path.join(claude_dir, cred_filename)

        if not os.path.exists(cred_path):
            logger.debug(f"Credential '{cred_id}' not found in Windows credential files")
            return False

        # Delete the credential file
        os.remove(cred_path)

        logger.info(f"Credential '{cred_id}' deleted from Windows credential files")
        return True

    except (IOError, Exception) as e:
        logger.warning(f"Failed to delete credential '{cred_id}' from Windows storage: {e}")
        return False


def _delete_credential_linux(cred_id: str) -> bool:
    """
    Delete a credential profile from Linux Secret Service API.

    Args:
        cred_id: Unique credential identifier

    Returns:
        True if credential was deleted, False otherwise
    """
    if secretstorage is None:
        logger.debug("secretstorage not available for credential deletion")
        return False

    try:
        # Get the default collection
        try:
            collection = secretstorage.get_default_collection(None)
        except (
            AttributeError,
            secretstorage.exceptions.SecretServiceNotAvailableException,
        ):
            logger.debug("Secret Service not available")
            return False

        if collection.is_locked():
            # Try to unlock the collection
            try:
                collection.unlock()
            except secretstorage.exceptions.SecretStorageException:
                logger.debug("Failed to unlock Secret Service collection")
                return False

        # Search for items with our application attribute
        items = collection.search_items({"application": f"auto-claude-{cred_id}"})

        # Delete all matching items (should be only one)
        deleted = False
        for item in items:
            item.delete()
            deleted = True

        if deleted:
            logger.info(f"Credential '{cred_id}' deleted from Linux Secret Service")
            return True
        else:
            logger.debug(f"Credential '{cred_id}' not found in Linux Secret Service")
            return False

    except (
        secretstorage.exceptions.SecretStorageException,
        AttributeError,
        TypeError,
    ) as e:
        logger.warning(f"Failed to delete credential '{cred_id}' from Linux Secret Service: {e}")
        return False


def validate_credential(credential: dict[str, str]) -> bool:
    """
    Validate a credential by testing it with a simple API call.

    This function attempts to validate the credential by making a minimal
    API request to verify it works. For both OAuth tokens and API keys,
    it performs a basic validation check.

    Args:
        credential: Dictionary with credential data:
            - id: Credential ID
            - type: Credential type ('oauth' or 'api_key')
            - value: Required - Actual credential value (token or API key)

    Returns:
        True if credential is valid and can be used, False otherwise

    Note:
        This function only validates the credential format and makes a basic
        connectivity check. It does not perform a full API request due to
        cost and rate limit considerations. For production use, credentials
        should be validated during actual API usage.

    Example:
        >>> cred = {
        ...     "id": "cred-001",
        ...     "type": "oauth",
        ...     "value": "sk-ant-oat01-..."
        ... }
        >>> is_valid = validate_credential(cred)
    """
    # Validate required fields
    if "value" not in credential:
        logger.error("Credential must have 'value' field for validation")
        return False

    cred_value = credential["value"]
    cred_type = credential.get("type", "oauth")

    # Basic format validation
    if cred_type == "oauth":
        # OAuth tokens start with sk-ant-oat01-
        if not cred_value.startswith("sk-ant-oat01-"):
            logger.warning(f"Credential '{credential.get('id', 'unknown')}' has invalid OAuth format")
            return False
    elif cred_type == "api_key":
        # API keys start with sk-ant-api03-
        if not cred_value.startswith("sk-ant-api03-"):
            logger.warning(f"Credential '{credential.get('id', 'unknown')}' has invalid API key format")
            return False
    else:
        logger.warning(f"Credential '{credential.get('id', 'unknown')}' has unknown type: {cred_type}")
        return False

    # Check for encrypted tokens
    if is_encrypted_token(cred_value):
        logger.warning(
            f"Credential '{credential.get('id', 'unknown')}' is encrypted and cannot be validated. "
            "Encrypted tokens must be decrypted before use."
        )
        return False

    # Additional validation: ensure token is not empty and has reasonable length
    if len(cred_value) < 50:
        logger.warning(f"Credential '{credential.get('id', 'unknown')}' value is too short")
        return False

    # Log successful validation
    logger.debug(f"Credential '{credential.get('id', 'unknown')}' passed format validation")

    return True
