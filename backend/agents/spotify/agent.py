"""
Spotify listening history agent — conversational interface to streaming_history data.

Uses the Anthropic Python SDK with native tool use. Claude writes SQL when it needs
data, calls execute_sql to run it, then synthesizes a natural language answer.
"""

import os
import logging
import anthropic

from .tools import execute_sql

logger = logging.getLogger(__name__)

CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", "")
MODEL = "claude-sonnet-4-20250514"
MAX_TOOL_ROUNDS = 5

SYSTEM_PROMPT = """\
You are a music listening data analyst. You have access to the user's Spotify \
streaming history stored in a Postgres database. Use the execute_sql tool to \
query the data when needed, then explain the results conversationally.

## Table: streaming_history (~140,000 rows, 2014–2026)

Each row is one playback event.

| Column             | Type        | Description                                    |
|--------------------|-------------|------------------------------------------------|
| id                 | BIGSERIAL   | Auto-increment primary key                     |
| ts                 | TIMESTAMPTZ | When playback occurred (ISO 8601)              |
| platform           | TEXT        | Device/OS (e.g. "iOS", "Android", "Windows")   |
| ms_played          | INTEGER     | Milliseconds the track was actually played      |
| conn_country       | TEXT        | Two-letter country code ("US", "CA", etc.)     |
| track_name         | TEXT        | Song title                                     |
| artist_name        | TEXT        | Artist name                                    |
| album_name         | TEXT        | Album name                                     |
| spotify_track_uri  | TEXT        | Spotify URI (format: spotify:track:<id>)       |
| reason_start       | TEXT        | How playback started (trackdone, fwdbtn, etc.) |
| reason_end         | TEXT        | How playback ended (trackdone, fwdbtn, etc.)   |
| shuffle            | BOOLEAN     | Shuffle mode was on                            |
| skipped            | BOOLEAN     | Track was skipped                              |
| offline            | BOOLEAN     | Played offline                                 |
| offline_timestamp  | BIGINT      | Unix timestamp of offline event                |
| incognito_mode     | BOOLEAN     | Private session                                |

## Indexed columns
ts, artist_name, track_name

## Key notes
- ms_played is in milliseconds. Divide by 60000 for minutes, 3600000 for hours.
- A typical full song play is 180,000–300,000 ms (3–5 minutes).
- Very short plays (< 30,000 ms) are often skips or previews.
- Some rows have NULL track_name or artist_name — these are unidentified plays.
- The data covers ~12 years of listening history.
- Only music tracks are in this table (podcasts and audiobooks were filtered out).

## Guidelines
- Write efficient SQL. Use indexes (ts, artist_name, track_name) when filtering.
- For "top" queries, use COUNT(*) or SUM(ms_played) as appropriate.
- When the user asks about "listening time", use SUM(ms_played) and convert to hours.
- For recent time references like "last month" or "this year", use the current date.
- If a query returns no results, say so clearly and suggest alternatives.
- For conversational messages that don't need data, just respond naturally.
- Keep answers concise but informative. Use markdown formatting for lists and tables.\
"""

TOOL_DEFINITION = {
    "name": "execute_sql",
    "description": (
        "Execute a read-only SQL SELECT query against the streaming_history table. "
        "Returns results as a JSON array of row objects. Limited to 500 rows."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "sql": {
                "type": "string",
                "description": "A SQL SELECT query to run against the streaming_history table.",
            }
        },
        "required": ["sql"],
    },
}


async def explore_music(messages: list[dict]) -> dict:
    """
    Run the Spotify agent on a conversation.

    Args:
        messages: Conversation history as [{role: "user"|"assistant", content: str}, ...]

    Returns:
        {"answer": str, "query": str | None}
    """
    if not CLAUDE_API_KEY:
        raise RuntimeError("CLAUDE_API_KEY env var is not set")

    client = anthropic.AsyncAnthropic(api_key=CLAUDE_API_KEY)

    # Build the messages for the API — keep the conversation history as-is
    api_messages = list(messages)

    last_query = None

    for _round in range(MAX_TOOL_ROUNDS):
        response = await client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=api_messages,
            tools=[TOOL_DEFINITION],
        )

        # If Claude wants to use a tool, execute it and loop
        if response.stop_reason == "tool_use":
            # Append the full assistant response (text + tool_use blocks)
            api_messages.append({"role": "assistant", "content": response.content})

            # Execute each tool call
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    sql = block.input.get("sql", "")
                    last_query = sql
                    logger.info(f"Executing SQL: {sql}")
                    result = await execute_sql(sql)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })

            api_messages.append({"role": "user", "content": tool_results})
            continue

        # No tool use — extract the text response
        answer = ""
        for block in response.content:
            if hasattr(block, "text"):
                answer += block.text

        return {"answer": answer, "query": last_query}

    # Exhausted tool rounds — return whatever we have
    return {
        "answer": "I wasn't able to complete the analysis within the allowed steps. Try a simpler question.",
        "query": last_query,
    }
