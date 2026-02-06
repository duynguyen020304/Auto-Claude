#!/usr/bin/env python3
"""
Review QA Runner - AI-powered code explanation for human review phase

This script provides an AI assistant that explains code changes to users
during the human review phase. It aggregates context from spec, plan, diff,
and execution logs to provide contextual, streaming responses.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Validate platform-specific dependencies BEFORE any imports that might
# trigger graphiti_core -> real_ladybug -> pywintypes import chain (ACS-253)
from core.dependency_validator import validate_platform_dependencies

validate_platform_dependencies()

# Load .env file with centralized error handling
from cli.utils import import_dotenv

load_dotenv = import_dotenv()

env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)

try:
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

    SDK_AVAILABLE = True
except ImportError:
    SDK_AVAILABLE = False
    ClaudeAgentOptions = None
    ClaudeSDKClient = None

from core.auth import ensure_claude_code_oauth_token, get_auth_token
from debug import (
    debug,
    debug_detailed,
    debug_error,
    debug_section,
    debug_success,
)
from phase_config import get_thinking_budget, resolve_model_id


def load_spec_context(spec_dir: str) -> str | None:
    """Load task specification from spec.md.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        Content of spec.md or None if not found
    """
    spec_path = Path(spec_dir) / "spec.md"
    if not spec_path.exists():
        return None

    try:
        with open(spec_path, encoding="utf-8") as f:
            return f.read()
    except (OSError, UnicodeDecodeError) as e:
        debug_error("review_qa_runner", f"Failed to read spec.md: {e}")
        return None


def load_plan_context(spec_dir: str) -> dict | None:
    """Load implementation plan from implementation_plan.json.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        Implementation plan dict or None if not found
    """
    plan_path = Path(spec_dir) / "implementation_plan.json"
    if not plan_path.exists():
        return None

    try:
        with open(plan_path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        debug_error("review_qa_runner", f"Failed to read implementation_plan.json: {e}")
        return None


def load_diff_context(spec_dir: str) -> str | None:
    """Load git diff context from worktree_diff.json if available.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        Formatted diff summary or None if not found
    """
    diff_path = Path(spec_dir) / "worktree_diff.json"
    if not diff_path.exists():
        return None

    try:
        with open(diff_path, encoding="utf-8") as f:
            diff_data = json.load(f)

        files = diff_data.get("files", [])
        if not files:
            return "No files changed in this task."

        # Format the diff for readability
        lines = ["## Git Diff Summary", f"Total files changed: {len(files)}", ""]

        # Group by status
        added = [f for f in files if f.get("status") == "added"]
        modified = [f for f in files if f.get("status") == "modified"]
        deleted = [f for f in files if f.get("status") == "deleted"]
        renamed = [f for f in files if f.get("status") == "renamed"]

        if added:
            lines.append(f"### Added ({len(added)})")
            for f in added[:20]:  # Limit to 20 files
                lines.append(f"- `{f.get('path', 'unknown')}`")
            if len(added) > 20:
                lines.append(f"- ... and {len(added) - 20} more")
            lines.append("")

        if modified:
            lines.append(f"### Modified ({len(modified)})")
            for f in modified[:20]:
                additions = f.get("additions", 0)
                deletions = f.get("deletions", 0)
                lines.append(f"- `{f.get('path', 'unknown')}` (+{additions}, -{deletions})")
            if len(modified) > 20:
                lines.append(f"- ... and {len(modified) - 20} more")
            lines.append("")

        if deleted:
            lines.append(f"### Deleted ({len(deleted)})")
            for f in deleted[:10]:
                lines.append(f"- `{f.get('path', 'unknown')}`")
            if len(deleted) > 10:
                lines.append(f"- ... and {len(deleted) - 10} more")
            lines.append("")

        if renamed:
            lines.append(f"### Renamed ({len(renamed)})")
            for f in renamed[:10]:
                lines.append(f"- `{f.get('path', 'unknown')}`")
            if len(renamed) > 10:
                lines.append(f"- ... and {len(renamed) - 10} more")
            lines.append("")

        return "\n".join(lines)

    except (json.JSONDecodeError, OSError) as e:
        debug_error("review_qa_runner", f"Failed to read worktree_diff.json: {e}")
        return None


def load_logs_context(spec_dir: str) -> str | None:
    """Load execution logs from build-progress.txt if available.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        Recent execution logs (truncated) or None if not found
    """
    logs_path = Path(spec_dir) / "build-progress.txt"
    if not logs_path.exists():
        return None

    try:
        with open(logs_path, encoding="utf-8") as f:
            lines = f.readlines()

        if not lines:
            return None

        # Get last 100 lines for recent context
        recent_lines = lines[-100:] if len(lines) > 100 else lines
        content = "".join(recent_lines).strip()

        return f"## Recent Execution Logs (last {len(recent_lines)} lines)\n```\n{content}\n```"

    except (OSError, UnicodeDecodeError) as e:
        debug_error("review_qa_runner", f"Failed to read build-progress.txt: {e}")
        return None


def load_code_explainer_prompt() -> str:
    """Load the code explainer prompt template.

    Returns:
        Content of code_explainer.md
    """
    prompt_path = Path(__file__).parent.parent / "prompts" / "code_explainer.md"
    try:
        with open(prompt_path, encoding="utf-8") as f:
            return f.read()
    except (OSError, UnicodeDecodeError) as e:
        debug_error("review_qa_runner", f"Failed to read code_explainer.md: {e}")
        # Fallback to basic prompt
        return """You are an AI assistant helping users understand code changes during the human review phase. Explain changes clearly for both technical and non-technical stakeholders."""


def build_system_prompt(spec_dir: str) -> str:
    """Build the system prompt with context from spec, plan, diff, and logs.

    Args:
        spec_dir: Path to the spec directory

    Returns:
        Complete system prompt with all context
    """
    # Load the base prompt template
    base_prompt = load_code_explainer_prompt()

    # Load context from all sources
    context_parts = []

    # 1. Spec context
    spec_content = load_spec_context(spec_dir)
    if spec_content:
        context_parts.append(f"## Task Specification\n{spec_content}")

    # 2. Plan context
    plan_data = load_plan_context(spec_dir)
    if plan_data:
        # Summarize the plan
        phases = plan_data.get("phases", [])
        total_subtasks = sum(len(p.get("subtasks", [])) for p in phases)
        plan_summary = f"""## Implementation Plan

**Feature:** {plan_data.get("feature", "Unknown")}
**Total Phases:** {len(phases)}
**Total Subtasks:** {total_subtasks}

**Status:** {plan_data.get("status", "unknown")}
"""
        context_parts.append(plan_summary)

    # 3. Diff context
    diff_content = load_diff_context(spec_dir)
    if diff_content:
        context_parts.append(diff_content)
    else:
        context_parts.append("## Git Diff\nNo diff information available yet.")

    # 4. Logs context
    logs_content = load_logs_context(spec_dir)
    if logs_content:
        context_parts.append(logs_content)

    # Combine base prompt with context
    if context_parts:
        full_context = "\n\n".join(context_parts)
        return f"""{base_prompt}

---

## AVAILABLE CONTEXT

The following context is available for this task:

{full_context}

---
"""
    else:
        return base_prompt


async def run_with_sdk(
    spec_dir: str,
    question: str,
    model: str = "sonnet",
    thinking_level: str = "medium",
) -> None:
    """Run the review QA using Claude SDK with streaming.

    Args:
        spec_dir: Path to the spec directory
        question: User's question about the changes
        model: Model to use (haiku, sonnet, opus, or full model ID)
        thinking_level: Thinking level for extended reasoning
    """
    if not SDK_AVAILABLE:
        print("Claude SDK not available", file=sys.stderr)
        sys.exit(1)

    if not get_auth_token():
        print("No authentication token found", file=sys.stderr)
        sys.exit(1)

    # Ensure SDK can find the token
    ensure_claude_code_oauth_token()

    # Build system prompt with context
    system_prompt = build_system_prompt(spec_dir)
    spec_path = Path(spec_dir).resolve()

    debug(
        "review_qa_runner",
        "Starting review QA",
        spec_dir=str(spec_dir),
        question_length=len(question),
        model=model,
        thinking_level=thinking_level,
    )

    # Convert thinking level to token budget
    max_thinking_tokens = get_thinking_budget(thinking_level)

    try:
        # Build options dict - only include max_thinking_tokens if not None
        options_kwargs = {
            "model": resolve_model_id(model),
            "system_prompt": system_prompt,
            "allowed_tools": ["Read", "Glob", "Grep"],
            "max_turns": 30,
            "cwd": str(spec_path),
        }

        # Only add thinking tokens if the thinking level is not "none"
        if max_thinking_tokens is not None:
            options_kwargs["max_thinking_tokens"] = max_thinking_tokens

        # Create Claude SDK client
        client = ClaudeSDKClient(options=ClaudeAgentOptions(**options_kwargs))

        # Use async context manager pattern
        async with client:
            # Send the query
            await client.query(question)

            # Stream the response
            response_text = ""
            current_tool = None

            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                debug_detailed("review_qa_runner", "Received message", msg_type=msg_type)

                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__
                        debug_detailed(
                            "review_qa_runner", "Processing block", block_type=block_type
                        )
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            text = block.text
                            debug_detailed(
                                "review_qa_runner", "Text block", text_length=len(text)
                            )
                            # Print text with newline for proper parsing
                            print(text, flush=True)
                            response_text += text
                        elif block_type == "ToolUseBlock" and hasattr(block, "name"):
                            # Emit tool start marker for UI feedback
                            tool_name = block.name
                            tool_input = ""

                            # Extract a brief description of what the tool is doing
                            if hasattr(block, "input") and block.input:
                                inp = block.input
                                if isinstance(inp, dict):
                                    if "pattern" in inp:
                                        tool_input = f"pattern: {inp['pattern']}"
                                    elif "file_path" in inp:
                                        # Shorten path for display
                                        fp = inp["file_path"]
                                        if len(fp) > 50:
                                            fp = "..." + fp[-47:]
                                        tool_input = fp
                                    elif "path" in inp:
                                        tool_input = inp["path"]

                            current_tool = tool_name
                            print(
                                f"__TOOL_START__:{json.dumps({'name': tool_name, 'input': tool_input})}",
                                flush=True,
                            )

                elif msg_type == "ToolResult":
                    # Tool finished executing
                    if current_tool:
                        print(
                            f"__TOOL_END__:{json.dumps({'name': current_tool})}",
                            flush=True,
                        )
                        current_tool = None

            # Ensure we have a newline at the end
            if response_text and not response_text.endswith("\n"):
                print()

            debug(
                "review_qa_runner",
                "Response complete",
                response_length=len(response_text),
            )

    except Exception as e:
        print(f"Error using Claude SDK: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Review QA Runner - Explain code changes")
    parser.add_argument("--spec-dir", required=True, help="Spec directory path")
    parser.add_argument("--question", required=True, help="User question about the changes")
    parser.add_argument(
        "--model",
        default="sonnet",
        help="Model to use (haiku, sonnet, opus, or full model ID)",
    )
    parser.add_argument(
        "--thinking-level",
        default="medium",
        choices=["none", "low", "medium", "high", "ultrathink"],
        help="Thinking level for extended reasoning (default: medium)",
    )
    args = parser.parse_args()

    debug_section("review_qa_runner", "Starting Review QA")

    spec_dir = args.spec_dir
    user_question = args.question
    model = args.model
    thinking_level = args.thinking_level

    debug(
        "review_qa_runner",
        "Arguments",
        spec_dir=spec_dir,
        question_length=len(user_question),
        model=model,
        thinking_level=thinking_level,
    )

    # Run the async SDK function
    asyncio.run(run_with_sdk(spec_dir, user_question, model, thinking_level))
    debug_success("review_qa_runner", "Query completed")


if __name__ == "__main__":
    main()
