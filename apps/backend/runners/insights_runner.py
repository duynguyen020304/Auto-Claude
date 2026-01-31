#!/usr/bin/env python3
"""
Insights Runner - AI chat for codebase insights using Claude SDK

This script provides an AI-powered chat interface for asking questions
about a codebase. It can also suggest tasks based on the conversation.
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


def load_project_context(project_dir: str) -> str:
    """Load project context for the AI."""
    context_parts = []

    # Load project index if available (from .auto-claude - the installed instance)
    index_path = Path(project_dir) / ".auto-claude" / "project_index.json"
    if index_path.exists():
        try:
            with open(index_path, encoding="utf-8") as f:
                index = json.load(f)
            # Summarize the index for context
            summary = {
                "project_root": index.get("project_root", ""),
                "project_type": index.get("project_type", "unknown"),
                "services": list(index.get("services", {}).keys()),
                "infrastructure": index.get("infrastructure", {}),
            }
            context_parts.append(
                f"## Project Structure\n```json\n{json.dumps(summary, indent=2)}\n```"
            )
        except Exception:
            pass

    # Load roadmap if available
    roadmap_path = Path(project_dir) / ".auto-claude" / "roadmap" / "roadmap.json"
    if roadmap_path.exists():
        try:
            with open(roadmap_path, encoding="utf-8") as f:
                roadmap = json.load(f)
            # Summarize roadmap
            features = roadmap.get("features", [])
            feature_summary = [
                {"title": f.get("title", ""), "status": f.get("status", "")}
                for f in features[:10]
            ]
            context_parts.append(
                f"## Roadmap Features\n```json\n{json.dumps(feature_summary, indent=2)}\n```"
            )
        except Exception:
            pass

    # Load existing tasks
    tasks_path = Path(project_dir) / ".auto-claude" / "specs"
    if tasks_path.exists():
        try:
            task_dirs = [d for d in tasks_path.iterdir() if d.is_dir()]
            task_names = [d.name for d in task_dirs[:10]]
            if task_names:
                context_parts.append(
                    "## Existing Tasks/Specs\n- " + "\n- ".join(task_names)
                )
        except Exception:
            pass

    return (
        "\n\n".join(context_parts)
        if context_parts
        else "No project context available yet."
    )


def load_roadmap_item_context(project_dir: str, item_id: str) -> dict | None:
    """Load context for a specific roadmap item.

    Args:
        project_dir: Path to the project directory
        item_id: ID of the roadmap item to load

    Returns:
        Dictionary with complete roadmap item context (title, description, rationale,
        priority, complexity, impact, dependencies, acceptanceCriteria, userStories,
        status) or None if not found.
    """
    roadmap_path = Path(project_dir) / ".auto-claude" / "roadmap" / "roadmap.json"

    if not roadmap_path.exists():
        return None

    try:
        with open(roadmap_path, encoding="utf-8") as f:
            roadmap = json.load(f)

        features = roadmap.get("features", [])

        # Find the feature by ID
        for feature in features:
            if feature.get("id") == item_id:
                return {
                    "title": feature.get("title", ""),
                    "description": feature.get("description", ""),
                    "rationale": feature.get("rationale", ""),
                    "priority": feature.get("priority", "should"),
                    "complexity": feature.get("complexity", "medium"),
                    "impact": feature.get("impact", "medium"),
                    "dependencies": feature.get("dependencies", []),
                    "acceptanceCriteria": feature.get("acceptanceCriteria", []),
                    "userStories": feature.get("userStories", []),
                    "status": feature.get("status", "not_started"),
                }

        return None

    except (json.JSONDecodeError, OSError):
        return None


def _is_binary_file(file_path: Path) -> bool:
    """Check if a file is likely binary by reading a small sample."""
    try:
        with open(file_path, 'rb') as f:
            chunk = f.read(8192)
            if not chunk:
                return False

            # Check for null bytes (common in binary files)
            if b'\x00' in chunk:
                return True

            # Check if the chunk has too many non-text characters
            # Text files typically have mostly printable ASCII/UTF-8
            text_characters = bytearray({7, 8, 9, 10, 12, 13, 27} | set(range(0x20, 0x100)) - {0x7f})
            non_text = sum(1 for byte in chunk if byte not in text_characters)

            # If more than 30% non-text characters, likely binary
            return non_text / len(chunk) > 0.3
    except Exception:
        # If we can't read it at all, treat as binary
        return True


def load_mentioned_files(project_dir: str, mentions: list) -> str:
    """Load contents of mentioned files with smart truncation for large files."""
    if not mentions:
        return ""

    project_path = Path(project_dir).resolve()
    file_contexts = []

    for mention in mentions:
        file_path = mention.get("filePath", "")
        line_start = mention.get("lineStart")
        line_end = mention.get("lineEnd")

        # Resolve file path relative to project directory
        full_path = project_path / file_path

        # Check if file exists
        if not full_path.exists():
            file_contexts.append(f"## {file_path}\n⚠️ File not found")
            continue

        # Check if it's a directory
        if full_path.is_dir():
            file_contexts.append(f"## {file_path}\n⚠️ Path is a directory, not a file")
            continue

        # Check if file is readable (permission check)
        if not full_path.is_file():
            file_contexts.append(f"## {file_path}\n⚠️ Path is not a valid file")
            continue

        # Check for binary file
        if _is_binary_file(full_path):
            file_contexts.append(f"## {file_path}\n⚠️ Binary file - cannot display content")
            continue

        try:
            with open(full_path, encoding="utf-8") as f:
                lines = f.readlines()

            total_lines = len(lines)

            # Smart truncation logic
            if line_start is not None and line_end is not None:
                # Specific line range requested
                start_idx = max(0, line_start - 1)
                end_idx = min(total_lines, line_end)
                selected_lines = lines[start_idx:end_idx]
                header = f"## {file_path} (lines {line_start}-{line_end} of {total_lines})"
            elif total_lines <= 500:
                # Small file - include all
                selected_lines = lines
                header = f"## {file_path} ({total_lines} lines)"
            elif total_lines <= 2000:
                # Medium file - include first 1000 and last 500 lines
                selected_lines = lines[:1000] + ["\n... (middle truncated) ...\n"] + lines[-500:]
                header = f"## {file_path} (showing lines 1-1000 and {total_lines-499}-{total_lines} of {total_lines})"
            else:
                # Large file - include first 500, last 300 lines
                selected_lines = lines[:500] + ["\n... (middle truncated) ...\n"] + lines[-300:]
                header = f"## {file_path} (showing lines 1-500 and {total_lines-299}-{total_lines} of {total_lines})"

            # Format line numbers
            if line_start is not None and line_end is not None:
                # Show line numbers for requested range
                content = "".join(
                    f"{line_start + i}: {line}" for i, line in enumerate(selected_lines)
                )
            else:
                content = "".join(selected_lines)

            file_contexts.append(f"{header}\n```\n{content}\n```")

        except PermissionError:
            file_contexts.append(f"## {file_path}\n⚠️ Permission denied - cannot read file")
        except UnicodeDecodeError:
            file_contexts.append(f"## {file_path}\n⚠️ File encoding error - cannot read as text")
        except OSError as e:
            file_contexts.append(f"## {file_path}\n⚠️ OS error reading file: {e}")
        except Exception as e:
            file_contexts.append(f"## {file_path}\n⚠️ Error reading file: {e}")

    return "\n\n".join(file_contexts) if file_contexts else ""


def build_system_prompt(project_dir: str, roadmap_context: dict = None) -> str:
    """Build the system prompt for the insights agent."""
    context = load_project_context(project_dir)

    # Build roadmap-specific context if provided
    roadmap_section = ""
    if roadmap_context:
        roadmap_section = f"""

## Roadmap Item Context
You are currently exploring a specific roadmap feature:

**Title:** {roadmap_context.get('title', 'Unknown')}

**Description:** {roadmap_context.get('description', 'No description')}

**Rationale:** {roadmap_context.get('rationale', 'No rationale provided')}

**Priority:** {roadmap_context.get('priority', 'should').capitalize()}

**Complexity:** {roadmap_context.get('complexity', 'medium').capitalize()}

**Impact:** {roadmap_context.get('impact', 'medium').capitalize()}

**User Stories:**
{chr(10).join(f"- {us}" for us in roadmap_context.get('userStories', [])) if roadmap_context.get('userStories') else 'None specified'}

**Acceptance Criteria:**
{chr(10).join(f"- {ac}" for ac in roadmap_context.get('acceptanceCriteria', []))}

**Dependencies:** {', '.join(roadmap_context.get('dependencies', [])) or 'None'}

**Status:** {roadmap_context.get('status', 'not_started').replace('_', ' ').title()}

When answering questions about this roadmap item, analyze the codebase and provide specific, actionable insights. Use the available tools (Read, Glob, Grep) to explore the codebase and ground your answers in actual code.
"""

    return f"""You are an AI assistant helping developers understand and work with their codebase.
You have access to the following project context:

{context}
{roadmap_section}
Your capabilities:
1. Answer questions about the codebase structure, patterns, and architecture
2. Suggest improvements, features, or bug fixes based on the code
3. Help plan implementation of new features
4. Provide code examples and explanations

## Roadmap Item Analysis
When a roadmap item context is provided above, you can help with:

**Scope Estimation:**
- Analyze the feature description and acceptance criteria
- Estimate effort based on actual codebase complexity
- Identify components, services, and modules involved
- Provide a complexity rating: trivial, small, medium, large, or complex

**Impact Analysis:**
- Identify what might break or change
- Find existing code that conflicts with the feature
- Detect potential side effects on other features
- List tests that may need updating

**Dependency Mapping:**
- Find code that depends on files/modules the feature touches
- Identify upstream dependencies (what this feature needs)
- Identify downstream consumers (what depends on this feature)
- Map integration points between services

**Affected Files Detection:**
- List specific files that likely need modification
- Group files by service/component
- Explain why each file is relevant
- Prioritize files by importance/complexity

**Complexity Estimation:**
- Assess technical complexity (architecture changes, new technologies)
- Assess implementation complexity (amount of code, testing needs)
- Provide time estimates with rationale
- Identify potential risks or blockers

Use the Read, Glob, and Grep tools to explore the codebase and provide specific, evidence-based answers. Always explain your reasoning and cite the files you examined.

## Task Suggestions
When the user asks you to create a task, wants to turn the conversation into a task, or when you believe creating a task would be helpful, output a task suggestion in this exact format on a SINGLE LINE:
__TASK_SUGGESTION__:{{"title": "Task title here", "description": "Detailed description of what the task involves", "metadata": {{"category": "feature", "complexity": "medium", "impact": "medium"}}}}

Valid categories: feature, bug_fix, refactoring, documentation, security, performance, ui_ux, infrastructure, testing
Valid complexity: trivial, small, medium, large, complex
Valid impact: low, medium, high, critical

Be conversational and helpful. Focus on providing actionable insights and clear explanations.
Keep responses concise but informative."""


async def run_with_sdk(
    project_dir: str,
    message: str,
    history: list,
    model: str = "sonnet",  # Shorthand - resolved via API Profile if configured
    thinking_level: str = "medium",
    mentions: list = None,
    roadmap_context: dict = None,
) -> None:
    """Run the chat using Claude SDK with streaming."""
    if not SDK_AVAILABLE:
        print("Claude SDK not available, falling back to simple mode", file=sys.stderr)
        run_simple(project_dir, message, history, mentions)
        return

    if not get_auth_token():
        print(
            "No authentication token found, falling back to simple mode",
            file=sys.stderr,
        )
        run_simple(project_dir, message, history, mentions)
        return

    # Ensure SDK can find the token
    ensure_claude_code_oauth_token()

    system_prompt = build_system_prompt(project_dir, roadmap_context)
    project_path = Path(project_dir).resolve()

    # Build conversation context from history
    conversation_context = ""
    for msg in history[:-1]:  # Exclude the latest message
        role = "User" if msg.get("role") == "user" else "Assistant"
        conversation_context += f"\n{role}: {msg['content']}\n"

    # Load mentioned files contents
    if mentions:
        debug(
            "insights_runner",
            "Loading mentioned files",
            mentions_count=len(mentions),
        )
    files_context = load_mentioned_files(project_dir, mentions or [])
    if files_context:
        debug_detailed(
            "insights_runner",
            "Loaded file contents",
            context_length=len(files_context),
        )

    # Build the full prompt with conversation history and file contents
    full_prompt = message
    if conversation_context.strip() or files_context:
        prompt_parts = []
        if conversation_context.strip():
            prompt_parts.append(f"""Previous conversation:
{conversation_context}""")
        if files_context:
            prompt_parts.append(f"""Referenced files:
{files_context}""")

        full_prompt = f"""{chr(10).join(prompt_parts)}

Current question: {message}"""

    # Convert thinking level to token budget
    max_thinking_tokens = get_thinking_budget(thinking_level)

    debug(
        "insights_runner",
        "Using model configuration",
        model=model,
        thinking_level=thinking_level,
        max_thinking_tokens=max_thinking_tokens,
    )

    try:
        # Build options dict - only include max_thinking_tokens if not None
        options_kwargs = {
            "model": resolve_model_id(model),  # Resolve via API Profile if configured
            "system_prompt": system_prompt,
            "allowed_tools": ["Read", "Glob", "Grep"],
            "max_turns": 30,  # Allow sufficient turns for codebase exploration
            "cwd": str(project_path),
        }

        # Only add thinking tokens if the thinking level is not "none"
        if max_thinking_tokens is not None:
            options_kwargs["max_thinking_tokens"] = max_thinking_tokens

        # Create Claude SDK client with appropriate settings for insights
        client = ClaudeSDKClient(options=ClaudeAgentOptions(**options_kwargs))

        # Use async context manager pattern
        async with client:
            # Send the query
            await client.query(full_prompt)

            # Stream the response
            response_text = ""
            current_tool = None

            async for msg in client.receive_response():
                msg_type = type(msg).__name__
                debug_detailed("insights_runner", "Received message", msg_type=msg_type)

                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__
                        debug_detailed(
                            "insights_runner", "Processing block", block_type=block_type
                        )
                        if block_type == "TextBlock" and hasattr(block, "text"):
                            text = block.text
                            debug_detailed(
                                "insights_runner", "Text block", text_length=len(text)
                            )
                            # Print text with newline to ensure proper line separation for parsing
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
                "insights_runner",
                "Response complete",
                response_length=len(response_text),
            )

    except Exception as e:
        print(f"Error using Claude SDK: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc(file=sys.stderr)
        run_simple(project_dir, message, history, mentions)


def run_simple(project_dir: str, message: str, history: list, mentions: list = None) -> None:
    """Simple fallback mode without SDK - uses subprocess to call claude CLI."""
    import subprocess

    system_prompt = build_system_prompt(project_dir)

    # Build conversation context
    conversation_context = ""
    for msg in history[:-1]:
        role = "User" if msg.get("role") == "user" else "Assistant"
        conversation_context += f"\n{role}: {msg['content']}\n"

    # Load mentioned files contents
    if mentions:
        debug(
            "insights_runner",
            "Loading mentioned files (simple mode)",
            mentions_count=len(mentions),
        )
    files_context = load_mentioned_files(project_dir, mentions or [])
    if files_context:
        debug_detailed(
            "insights_runner",
            "Loaded file contents (simple mode)",
            context_length=len(files_context),
        )

    # Create the full prompt with file contents
    prompt_parts = [system_prompt]
    if conversation_context.strip():
        prompt_parts.append(f"""Previous conversation:
{conversation_context}""")
    if files_context:
        prompt_parts.append(f"""Referenced files:
{files_context}""")

    prompt_parts.append(f"User: {message}\nAssistant:")

    full_prompt = "\n\n".join(prompt_parts)

    try:
        # Try to use claude CLI with --print for simple output
        result = subprocess.run(
            ["claude", "--print", "-p", full_prompt],
            capture_output=True,
            text=True,
            cwd=project_dir,
            timeout=120,
        )

        if result.returncode == 0:
            print(result.stdout)
        else:
            # Fallback response if claude CLI fails
            print(
                f"I apologize, but I encountered an issue processing your request. "
                f"Please ensure Claude CLI is properly configured.\n\n"
                f"Your question was: {message}\n\n"
                f"Based on the project context available, I can help you with:\n"
                f"- Understanding the codebase structure\n"
                f"- Suggesting improvements\n"
                f"- Planning new features\n\n"
                f"Please try again or check your Claude CLI configuration."
            )

    except subprocess.TimeoutExpired:
        print("Request timed out. Please try a shorter query.")
    except FileNotFoundError:
        print("Claude CLI not found. Please ensure it is installed and in your PATH.")
    except Exception as e:
        print(f"Error: {e}")


def main():
    parser = argparse.ArgumentParser(description="Insights AI Chat Runner")
    parser.add_argument("--project-dir", required=True, help="Project directory path")
    parser.add_argument("--message", required=True, help="User message")
    parser.add_argument("--history", default="[]", help="JSON conversation history")
    parser.add_argument(
        "--history-file", help="Path to JSON file containing conversation history"
    )
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
    parser.add_argument(
        "--mentions",
        default="[]",
        help='JSON array of file mentions to include in context (e.g., \'[{"filePath": "src/App.tsx", "lineStart": 10, "lineEnd": 20}]\')',
    )
    parser.add_argument(
        "--roadmap-item-id",
        default=None,
        help="ID of the roadmap item to provide context for",
    )
    args = parser.parse_args()

    debug_section("insights_runner", "Starting Insights Chat")

    project_dir = args.project_dir
    user_message = args.message
    model = args.model
    thinking_level = args.thinking_level

    debug(
        "insights_runner",
        "Arguments",
        project_dir=project_dir,
        message_length=len(user_message),
        model=model,
        thinking_level=thinking_level,
    )

    # Load history from file if provided, otherwise parse inline JSON
    try:
        if args.history_file:
            debug(
                "insights_runner", "Loading history from file", file=args.history_file
            )
            with open(args.history_file, encoding="utf-8") as f:
                history = json.load(f)
            debug_detailed(
                "insights_runner",
                "Loaded history from file",
                history_length=len(history),
            )
        else:
            history = json.loads(args.history)
            debug_detailed(
                "insights_runner", "Parsed inline history", history_length=len(history)
            )
    except (json.JSONDecodeError, FileNotFoundError, OSError) as e:
        debug_error("insights_runner", f"Failed to load history: {e}")
        history = []

    # Parse file mentions from JSON
    try:
        mentions = json.loads(args.mentions)
        debug_detailed(
            "insights_runner", "Parsed file mentions", mentions_count=len(mentions)
        )
    except json.JSONDecodeError as e:
        debug_error("insights_runner", f"Failed to parse mentions: {e}")
        mentions = []

    # Load roadmap item context if provided
    roadmap_context = None
    if args.roadmap_item_id:
        debug_detailed(
            "insights_runner",
            "Loading roadmap item context",
            item_id=args.roadmap_item_id,
        )
        roadmap_context = load_roadmap_item_context(project_dir, args.roadmap_item_id)
        if roadmap_context:
            debug_success(
                "insights_runner",
                "Loaded roadmap item context",
                title=roadmap_context.get("title", "Unknown"),
            )
        else:
            debug_error(
                "insights_runner",
                f"Roadmap item {args.roadmap_item_id} not found",
            )

    # Run the async SDK function
    debug("insights_runner", "Running SDK query")
    asyncio.run(run_with_sdk(project_dir, user_message, history, model, thinking_level, mentions, roadmap_context))
    debug_success("insights_runner", "Query completed")


if __name__ == "__main__":
    main()
