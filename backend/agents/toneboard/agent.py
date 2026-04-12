"""ToneBoard chat agent — entry point.

Wraps the Claude Agent SDK with tone-specific tools and the built-in
WebSearch tool so Claude can research real-world guitar rigs before
patching a tone row.
"""

import os

# The SDK reads ANTHROPIC_API_KEY; alias from our existing CLAUDE_API_KEY.
os.environ.setdefault("ANTHROPIC_API_KEY", os.getenv("CLAUDE_API_KEY", ""))

import logging
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    query,
)

from .prompts import SYSTEM_PROMPT
from .tools import make_tone_tools

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-5"
MAX_TURNS = 8
MAX_BUDGET_USD = 0.25


def _history_to_prompt(prior_messages: list[dict], user_message: str) -> str:
    """Flatten prior conversation into a plain-text preamble for the fresh session."""
    lines: list[str] = []
    for msg in prior_messages:
        role = msg.get("role", "")
        blocks = msg.get("content", []) or []
        text_parts: list[str] = []
        for b in blocks:
            if isinstance(b, dict) and b.get("type") == "text":
                t = b.get("text", "")
                if t:
                    text_parts.append(t)
        text = " ".join(text_parts).strip()
        if text:
            lines.append(f"{role.capitalize()}: {text}")

    if lines:
        return "Conversation so far:\n" + "\n".join(lines) + "\n\nUser: " + user_message
    return user_message


async def run_tone_chat(
    tone_id: str,
    prior_messages: list[dict],
    user_message: str,
) -> list[dict]:
    """Run the tone-chat agent for a single user turn.

    Args:
        tone_id: UUID of the tone row being edited.
        prior_messages: list of {"role": "user"|"assistant", "content": [blocks]}
            loaded from the tone_messages table, ordered oldest-first.
        user_message: the new user text for this turn.

    Returns:
        A list of simplified content blocks from the assistant turn:
            [{"type": "text", "text": "..."},
             {"type": "tool_use", "name": "...", "input": {...}}, ...]
    """
    tone_server = make_tone_tools(tone_id)

    prompt = _history_to_prompt(prior_messages, user_message)

    options = ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        mcp_servers={"tone": tone_server},
        allowed_tools=[
            "mcp__tone__get_tone",
            "mcp__tone__update_tone",
            "WebSearch",
        ],
        permission_mode="dontAsk",
        max_turns=MAX_TURNS,
        max_budget_usd=MAX_BUDGET_USD,
        model=MODEL,
    )

    collected_blocks: list[dict[str, Any]] = []
    result_subtype: str | None = None
    result_is_error: bool = False

    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    if block.text:
                        collected_blocks.append(
                            {"type": "text", "text": block.text}
                        )
                elif isinstance(block, ToolUseBlock):
                    collected_blocks.append(
                        {
                            "type": "tool_use",
                            "name": block.name,
                            "input": dict(block.input or {}),
                        }
                    )
                # ThinkingBlock / ToolResultBlock intentionally dropped.
        elif isinstance(message, ResultMessage):
            result_subtype = message.subtype
            result_is_error = bool(getattr(message, "is_error", False))

    if result_subtype != "success" or result_is_error:
        logger.warning(
            "tone-chat agent returned non-success: subtype=%s is_error=%s",
            result_subtype,
            result_is_error,
        )
        collected_blocks.append(
            {
                "type": "text",
                "text": f"[agent error: {result_subtype or 'unknown'}]",
            }
        )

    return collected_blocks
