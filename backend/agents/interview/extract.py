"""Résumé text extraction via Sonnet 4.6 multimodal PDF input.

Called once per interview start (not cached). The extracted text is folded
into the interview's system prompt and persisted alongside it.
"""

import base64
import os

from anthropic import AsyncAnthropic

EXTRACT_MODEL = "claude-sonnet-4-6"
EXTRACT_PROMPT = (
    "Extract the full text content of this résumé. Preserve section "
    "headings, bullet structure, and the order in which content appears. "
    "Return plain text only — no commentary, no markdown fences."
)


async def extract_resume_text(pdf_bytes: bytes) -> str:
    api_key = os.getenv("CLAUDE_API_KEY", "")
    if not api_key:
        raise RuntimeError("CLAUDE_API_KEY not configured")
    client = AsyncAnthropic(api_key=api_key)
    b64 = base64.standard_b64encode(pdf_bytes).decode("ascii")

    msg = await client.messages.create(
        model=EXTRACT_MODEL,
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": b64,
                        },
                    },
                    {"type": "text", "text": EXTRACT_PROMPT},
                ],
            }
        ],
    )

    parts = [b.text for b in msg.content if getattr(b, "type", None) == "text"]
    return "\n".join(parts).strip()
