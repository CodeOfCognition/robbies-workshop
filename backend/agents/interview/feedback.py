"""Post-interview feedback agent.

Streams a markdown debrief with three sections (What worked / Opportunities /
Overall) given the interviewer's system prompt and the full transcript.
Idempotent: if `interviews.feedback` is already populated, the cached
content is yielded as-is without re-running the model.
"""

import json
import logging
import os
from typing import AsyncIterator

from anthropic import AsyncAnthropic

from db import get_pool

logger = logging.getLogger(__name__)

FEEDBACK_MODEL = "claude-opus-4-7"
MAX_TOKENS = 4096

FEEDBACK_SYSTEM = """You are giving feedback on a mock interview a candidate just completed for practice.

You will receive:
1. The system prompt that was given to the interviewer (it contains the company, role, candidate background, résumé, and any guidance the candidate set for this session).
2. The full transcript of the interview.

Write the candidate honest, useful feedback in markdown with exactly these three sections, in this order:

# What worked

Specific moments that landed. Name the answer, the technique, the framing. Generic praise is useless — quote a phrase or call out a concrete move. 3–5 bullets.

# Opportunities

What could be sharper next time. Name the answer, name the issue, name the fix. Constructive but direct — sandbagging doesn't help them prepare. 3–5 bullets.

# Overall

Two or three sentences. The headline read of this round.

Rules:
- Write in second person ("you opened with...", "you let the question hang…").
- Don't reference yourself, the system prompt, or "the interviewer's notes".
- Don't preface with "Here is your feedback" or recap the format.
- If the interview ended very early (one or two exchanges), say so directly in Overall — don't pad."""


def _sse(payload: dict) -> bytes:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def _decode_jsonb(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def _format_transcript(transcript: list) -> str:
    lines = []
    for msg in transcript:
        role = msg.get("role", "")
        text = msg.get("text", "")
        label = "Interviewer" if role == "interviewer" else "Candidate"
        lines.append(f"**{label}:** {text}\n")
    return "\n".join(lines)


async def run_feedback(interview_id: str) -> AsyncIterator[bytes]:
    pool = await get_pool()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT system_prompt, transcript, feedback FROM interviews "
            "WHERE id = $1::uuid",
            interview_id,
        )
        if row is None:
            yield _sse({"type": "error", "message": "Interview not found"})
            return

    cached = row["feedback"]
    if cached and cached.strip():
        # Hand back the cached version one chunk at a time so the client can
        # use the same streaming codepath.
        yield _sse({"type": "delta", "text": cached})
        yield _sse({"type": "done", "feedback": cached})
        return

    transcript = _decode_jsonb(row["transcript"]) or []
    if not transcript:
        yield _sse(
            {
                "type": "error",
                "message": "No transcript yet — there's nothing to give feedback on.",
            }
        )
        return

    system_prompt = row["system_prompt"] or "(no interviewer system prompt on file)"

    api_key = os.getenv("CLAUDE_API_KEY", "")
    if not api_key:
        yield _sse({"type": "error", "message": "CLAUDE_API_KEY not configured"})
        return
    client = AsyncAnthropic(api_key=api_key)

    user_message = (
        "<interviewer_system_prompt>\n"
        f"{system_prompt}\n"
        "</interviewer_system_prompt>\n\n"
        "<transcript>\n"
        f"{_format_transcript(transcript)}\n"
        "</transcript>"
    )

    text_parts: list[str] = []
    try:
        async with client.messages.stream(
            model=FEEDBACK_MODEL,
            system=FEEDBACK_SYSTEM,
            messages=[{"role": "user", "content": user_message}],
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
            max_tokens=MAX_TOKENS,
        ) as stream:
            async for event in stream:
                if (
                    getattr(event, "type", "") == "content_block_delta"
                    and getattr(event.delta, "type", "") == "text_delta"
                ):
                    chunk = event.delta.text
                    text_parts.append(chunk)
                    yield _sse({"type": "delta", "text": chunk})
    except Exception as e:
        logger.exception("Feedback stream failed")
        yield _sse({"type": "error", "message": str(e)})
        return

    full_text = "".join(text_parts).strip()
    if full_text:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE interviews SET feedback = $1, updated_at = NOW() "
                "WHERE id = $2::uuid",
                full_text,
                interview_id,
            )

    yield _sse({"type": "done", "feedback": full_text})
