"""ToneBoard chat agent — entry point.

Wraps the Claude Agent SDK with tone-specific tools and the built-in
WebSearch tool so Claude can research real-world guitar rigs before
patching a tone row.
"""

import os

# The SDK reads ANTHROPIC_API_KEY; alias from our existing CLAUDE_API_KEY.
os.environ.setdefault("ANTHROPIC_API_KEY", os.getenv("CLAUDE_API_KEY", ""))

import json
import logging
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    query,
)

from .prompts import SYSTEM_PROMPT
from .tools import make_tone_tools

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"
MAX_TURNS = 10
MAX_BUDGET_USD = 0.50


_TOOL_INPUT_MAX_CHARS = 1000
_TOOL_RESULT_MAX_CHARS = 5000


def _history_to_prompt(prior_messages: list[dict], user_message: str) -> str:
    """Flatten prior conversation into a plain-text preamble for the fresh session.

    Tool_use and tool_result blocks are interleaved in the order the agent
    produced them so Claude sees each decision alongside its outcome.
    """
    lines: list[str] = []
    for msg in prior_messages:
        role = msg.get("role", "")
        blocks = msg.get("content", []) or []
        text_parts: list[str] = []
        tool_lines: list[str] = []
        for b in blocks:
            if not isinstance(b, dict):
                continue
            btype = b.get("type")
            if btype == "text":
                t = b.get("text", "")
                if t:
                    text_parts.append(t)
            elif btype == "tool_use":
                name = b.get("name", "?")
                try:
                    input_str = json.dumps(b.get("input") or {}, default=str)
                except (TypeError, ValueError):
                    input_str = str(b.get("input"))
                if len(input_str) > _TOOL_INPUT_MAX_CHARS:
                    input_str = input_str[:_TOOL_INPUT_MAX_CHARS] + "...(truncated)"
                tool_lines.append(f"[tool_use: {name}({input_str})]")
            elif btype == "tool_result":
                content = b.get("content")
                if content is None:
                    content_str = ""
                elif isinstance(content, str):
                    content_str = content
                else:
                    try:
                        content_str = json.dumps(content, default=str)
                    except (TypeError, ValueError):
                        content_str = str(content)
                if len(content_str) > _TOOL_RESULT_MAX_CHARS:
                    content_str = content_str[:_TOOL_RESULT_MAX_CHARS] + "...(truncated)"
                label = "tool_error" if b.get("is_error") else "tool_result"
                tool_lines.append(f"[{label}: {content_str}]")

        text = " ".join(text_parts).strip()
        if text or tool_lines:
            header = f"{role.capitalize()}: {text}" if text else f"{role.capitalize()}:"
            lines.append(header)
            lines.extend(tool_lines)

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
        elif isinstance(message, UserMessage):
            # SDK feeds tool_result blocks back as a UserMessage after each
            # tool_use. Persist them so future turns can see what the tools
            # returned, not just that they were called.
            if isinstance(message.content, list):
                for block in message.content:
                    if isinstance(block, ToolResultBlock):
                        collected_blocks.append(
                            {
                                "type": "tool_result",
                                "content": block.content,
                                "is_error": bool(block.is_error),
                            }
                        )
        elif isinstance(message, ResultMessage):
            result_subtype = message.subtype
            result_is_error = bool(getattr(message, "is_error", False))
            logger.info(
                "tone-chat run finished: subtype=%s is_error=%s num_turns=%s "
                "duration_ms=%s total_cost_usd=%s",
                message.subtype,
                message.is_error,
                message.num_turns,
                message.duration_ms,
                message.total_cost_usd,
            )

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
