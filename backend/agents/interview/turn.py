"""Single endpoint that drives the live interview agent.

Lazy-initializes the system prompt on the first turn (extracts the résumé,
assembles the prompt, persists it on the interview row), then streams the
agent's response. Subsequent turns reuse the persisted prompt.
"""

import json
import logging
import os
import re
from typing import AsyncIterator
from urllib.parse import quote

import httpx
from anthropic import AsyncAnthropic

from db import get_pool

from .extract import extract_resume_text
from .prompt import build_system_prompt

logger = logging.getLogger(__name__)

INTERVIEW_MODEL = "claude-opus-4-7"
RESUME_BUCKET = "interview-resumes"
DEFAULT_DURATION_MIN = 30
DEFAULT_QUESTION_BUDGET = 8


def _resolve_supabase_url() -> str:
    """Use SUPABASE_URL if explicitly set; otherwise derive from
    SUPABASE_DB_URL. Both pooler (`postgres.<ref>:`) and direct
    (`db.<ref>.supabase.co`) DB URL formats reveal the project ref.
    """
    explicit = os.getenv("SUPABASE_URL", "").rstrip("/")
    if explicit:
        return explicit
    db_url = os.getenv("SUPABASE_DB_URL", "")
    m = re.search(r"postgres\.([a-z0-9]+):", db_url) or re.search(
        r"db\.([a-z0-9]+)\.supabase\.co", db_url
    )
    if m:
        return f"https://{m.group(1)}.supabase.co"
    return ""


SUPABASE_URL = _resolve_supabase_url()
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _sse(payload: dict) -> bytes:
    # ensure_ascii=False so non-ASCII text in deltas isn't double-escaped.
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def _decode_jsonb(value):
    """asyncpg returns jsonb as a string by default; decode it."""
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    return json.loads(value)


async def _fetch_resume_pdf(storage_path: str) -> bytes:
    if not SUPABASE_URL:
        raise RuntimeError(
            "SUPABASE_URL could not be resolved (check SUPABASE_DB_URL or set "
            "SUPABASE_URL explicitly)"
        )
    if not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY not configured on backend")
    safe_path = quote(storage_path, safe="/")
    url = f"{SUPABASE_URL}/storage/v1/object/{RESUME_BUCKET}/{safe_path}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            url,
            headers={"Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
        )
        r.raise_for_status()
        return r.content


def _extract_memory_texts(memories_value) -> list[str]:
    decoded = _decode_jsonb(memories_value) or []
    out: list[str] = []
    for m in decoded:
        if isinstance(m, dict):
            text = m.get("text")
            if text:
                out.append(text)
    return out


async def run_turn(
    interview_id: str, user_message: str | None
) -> AsyncIterator[bytes]:
    pool = await get_pool()

    async with pool.acquire() as conn:
        interview = await conn.fetchrow(
            "SELECT * FROM interviews WHERE id = $1::uuid", interview_id
        )
        if interview is None:
            yield _sse({"type": "error", "message": "Interview not found"})
            return
        profile = await conn.fetchrow(
            "SELECT * FROM profiles WHERE id = $1::uuid", interview["profile_id"]
        )
        job = await conn.fetchrow(
            "SELECT * FROM jobs WHERE id = $1::uuid", interview["job_id"]
        )
        if profile is None or job is None:
            yield _sse({"type": "error", "message": "Profile or job missing"})
            return

    transcript = _decode_jsonb(interview["transcript"]) or []

    if user_message:
        transcript.append({"role": "candidate", "text": user_message})
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE interviews SET transcript = $1::jsonb, updated_at = NOW() "
                "WHERE id = $2::uuid",
                json.dumps(transcript),
                interview_id,
            )

    system_prompt = interview["system_prompt"]
    if not system_prompt:
        resume_text = ""
        resume = _decode_jsonb(profile["resume"])
        if resume and resume.get("storagePath"):
            try:
                pdf_bytes = await _fetch_resume_pdf(resume["storagePath"])
                resume_text = await extract_resume_text(pdf_bytes)
            except Exception:
                logger.exception("Résumé extraction failed")
                # Don't persist a half-broken system prompt — surface the
                # error so the user can retry (e.g. after re-uploading) and
                # we'll re-attempt extraction next call.
                yield _sse(
                    {
                        "type": "error",
                        "message": (
                            "Couldn't read the résumé PDF. Try removing and "
                            "re-uploading it, then start the interview again."
                        ),
                    }
                )
                return

        system_prompt = build_system_prompt(
            interview_type=interview["type"],
            company=job["company"] or "",
            role=job["role"] or "",
            posting=job["posting"] or "",
            research=job["research"] or "",
            candidate_name=profile["name"] or "",
            resume_text=resume_text,
            memories=_extract_memory_texts(profile["memories"]),
            guidance=interview["notes"] or "",
            duration_minutes=DEFAULT_DURATION_MIN,
            question_budget=DEFAULT_QUESTION_BUDGET,
        )

        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE interviews SET system_prompt = $1, updated_at = NOW() "
                "WHERE id = $2::uuid",
                system_prompt,
                interview_id,
            )

    # Anthropic message history. The synthetic "begin interview" trigger is
    # sent every turn but never persisted to the visible transcript.
    messages: list[dict] = [{"role": "user", "content": "begin interview"}]
    for msg in transcript:
        role = "user" if msg.get("role") == "candidate" else "assistant"
        text = msg.get("text", "")
        if text:
            messages.append({"role": role, "content": text})

    api_key = os.getenv("CLAUDE_API_KEY", "")
    if not api_key:
        yield _sse({"type": "error", "message": "CLAUDE_API_KEY not configured"})
        return
    client = AsyncAnthropic(api_key=api_key)

    text_parts: list[str] = []
    try:
        async with client.messages.stream(
            model=INTERVIEW_MODEL,
            system=system_prompt,
            messages=messages,
            tools=[
                {
                    "type": "web_search_20250305",
                    "name": "web_search",
                    "max_uses": 6,
                }
            ],
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
            max_tokens=4096,
        ) as stream:
            async for event in stream:
                etype = getattr(event, "type", "")
                if etype == "content_block_start":
                    block_type = getattr(event.content_block, "type", "")
                    if block_type in ("server_tool_use", "tool_use"):
                        name = getattr(event.content_block, "name", "")
                        yield _sse({"type": "tool_use", "name": name or "tool"})
                elif etype == "content_block_delta":
                    delta_type = getattr(event.delta, "type", "")
                    if delta_type == "text_delta":
                        chunk = event.delta.text
                        text_parts.append(chunk)
                        yield _sse({"type": "delta", "text": chunk})
    except Exception as e:
        logger.exception("Anthropic stream failed")
        yield _sse({"type": "error", "message": str(e)})
        return

    full_text = "".join(text_parts).strip()
    if full_text:
        transcript.append({"role": "interviewer", "text": full_text})
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE interviews SET transcript = $1::jsonb, updated_at = NOW() "
                "WHERE id = $2::uuid",
                json.dumps(transcript),
                interview_id,
            )

    yield _sse(
        {
            "type": "done",
            "assistantMessage": {"role": "interviewer", "text": full_text},
        }
    )
