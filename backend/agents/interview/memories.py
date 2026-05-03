"""Post-interview memory extraction.

Reads the transcript + profile (résumé, prior memories) and proposes a small
set of durable memories that future interview/feedback agents should know
about this candidate. Each proposal is either a new memory or an update that
replaces an existing one (when the new text corrects or refines an old
memory).

Output shape (after parsing):
  [
    { "id": "pm_…", "text": "…", "state": "pending" },
    { "id": "pm_…", "text": "…", "state": "pending", "replacesId": "m_…" },
  ]

Persisted to `interviews.proposed_memories`. Idempotent: if proposals already
exist, returns them as-is.
"""

import json
import logging
import os
import secrets
from typing import AsyncIterator

from anthropic import AsyncAnthropic

from db import get_pool

logger = logging.getLogger(__name__)

MEMORIES_MODEL = "claude-opus-4-7"
MAX_TOKENS = 4096

MEMORIES_SYSTEM = """You are extracting durable memories about a candidate from a mock interview they just completed.

You will receive:
1. The interviewer's full context block (company, role, posting, research notes, candidate name, FULL résumé text, and any guidance the candidate set for the session).
2. The candidate's existing memories, each with an id.
3. The full transcript of the interview.

Your goal: produce a small set of high-quality memories that future interview prep tools (the AI interviewer, the AI feedback reviewer) should know about this candidate.

What makes a good memory:
- **Specific.** "Tends to bury the lede; usually leads with context before the action" is good. "Communicates well" is not.
- **Durable.** Things about the candidate's history, motivations, communication patterns, blind spots, or what they care about — facts that will still matter in the next interview prep session.
- **About the candidate, descriptively.** Memories describe what is true about the candidate, not what they should do.
- **Atomic.** One fact per memory.

What memory is NOT:
- **Anything already in the résumé.** The résumé text is in the context block above. If a sentence about the candidate could be reconstructed from the résumé alone (job titles, headcount, tools, dates, employers, projects listed there), it does NOT belong in memory. Memory captures what's *between the lines* — colour, motivation, communication style, things the candidate said in the interview that aren't on paper.
- **Prescriptive.** No "should", no "needs to", no "be prepared to", no "make sure to". Memory describes the candidate; it does not give them advice. Advice belongs in feedback, which is a separate agent.
- A summary of this interview ("answered question 3 well") — that belongs in feedback.
- Anything already captured by an existing memory.
- Vague generalities.

For each candidate fact/pattern that surfaced in this interview, decide:
1. Is it on the résumé or already captured by an existing memory? Skip.
2. Is it prescriptive advice rather than a description of the candidate? Skip.
3. Does it CONTRADICT or REFINE an existing memory (the existing one is wrong, outdated, or imprecise)? Propose an update — give the existing memory's id and the new text.
4. Is it NEW descriptive signal worth keeping? Propose a new memory.

Be conservative on updates. Only propose them when an existing memory is actually wrong or imprecise — not when you just have a different angle on the same point. When in doubt, skip rather than clutter.

Output STRICT JSON only — an array of objects. No markdown fences, no commentary, no preamble:

[
  { "kind": "new", "text": "…" },
  { "kind": "update", "replaces_id": "m_xxx", "text": "…" }
]

If no memories are worth proposing (e.g. the interview ended too early to learn anything new beyond what's already on the résumé), return [].
"""


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


def _format_existing_memories(memories: list) -> str:
    if not memories:
        return "(none yet — this is the first interview on this profile)"
    lines = []
    for m in memories:
        if isinstance(m, dict) and m.get("text"):
            lines.append(f'- id="{m.get("id", "?")}": {m["text"]}')
    return "\n".join(lines) if lines else "(none)"


def _new_pm_id() -> str:
    return "pm_" + secrets.token_hex(6)


def _parse_proposals(raw: str, existing_ids: set[str]) -> list[dict]:
    """Parse the model's JSON output into the wire shape stored in
    interviews.proposed_memories. Drops malformed items rather than failing
    the whole batch.
    """
    raw = raw.strip()
    # Tolerate fence wrappers like ```json ... ```.
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()
    # If the model added prose around the array, slice from first `[` to
    # last `]`. JSON is greedy enough that this works for our flat shape.
    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end != -1 and end > start:
        raw = raw[start : end + 1]
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        logger.exception("Failed to parse memory proposals JSON: %r", raw[:200])
        return []
    if not isinstance(items, list):
        return []

    out: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        text = item.get("text", "").strip()
        if not text:
            continue
        kind = item.get("kind", "new")
        proposal = {"id": _new_pm_id(), "text": text, "state": "pending"}
        if kind == "update":
            replaces = item.get("replaces_id")
            # Drop updates that reference a memory that doesn't actually
            # exist on the profile — likely a model hallucination.
            if replaces and replaces in existing_ids:
                proposal["replacesId"] = replaces
            else:
                # Demote to a new memory rather than dropping the content.
                pass
        out.append(proposal)
    return out


async def run_memories(interview_id: str) -> AsyncIterator[bytes]:
    pool = await get_pool()

    async with pool.acquire() as conn:
        interview = await conn.fetchrow(
            "SELECT profile_id, transcript, proposed_memories, system_prompt "
            "FROM interviews WHERE id = $1::uuid",
            interview_id,
        )
        if interview is None:
            yield _sse({"type": "error", "message": "Interview not found"})
            return
        profile = await conn.fetchrow(
            "SELECT memories FROM profiles WHERE id = $1::uuid",
            interview["profile_id"],
        )

    cached = _decode_jsonb(interview["proposed_memories"])
    if cached is not None:
        # Treat any non-null array as "agent already ran" — including [].
        yield _sse({"type": "done", "proposals": cached})
        return

    transcript = _decode_jsonb(interview["transcript"]) or []
    if not transcript:
        yield _sse({"type": "done", "proposals": []})
        return

    existing_memories = _decode_jsonb(profile["memories"]) or []
    existing_ids = {m.get("id") for m in existing_memories if isinstance(m, dict)}
    interviewer_context = (
        interview["system_prompt"]
        or "(no interviewer context — résumé and job details are unavailable)"
    )

    user_message = (
        "<interviewer_context>\n"
        f"{interviewer_context}\n"
        "</interviewer_context>\n\n"
        "<existing_memories>\n"
        f"{_format_existing_memories(existing_memories)}\n"
        "</existing_memories>\n\n"
        "<transcript>\n"
        f"{_format_transcript(transcript)}\n"
        "</transcript>"
    )

    api_key = os.getenv("CLAUDE_API_KEY", "")
    if not api_key:
        yield _sse({"type": "error", "message": "CLAUDE_API_KEY not configured"})
        return
    client = AsyncAnthropic(api_key=api_key)

    text_parts: list[str] = []
    try:
        async with client.messages.stream(
            model=MEMORIES_MODEL,
            system=MEMORIES_SYSTEM,
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
                    text_parts.append(event.delta.text)
    except Exception as e:
        logger.exception("Memory stream failed")
        yield _sse({"type": "error", "message": str(e)})
        return

    raw = "".join(text_parts)
    proposals = _parse_proposals(raw, existing_ids)

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE interviews SET proposed_memories = $1::jsonb, "
            "updated_at = NOW() WHERE id = $2::uuid",
            json.dumps(proposals),
            interview_id,
        )

    yield _sse({"type": "done", "proposals": proposals})
