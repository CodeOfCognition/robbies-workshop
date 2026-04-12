"""Custom SDK tools for the ToneBoard agent — get/update the tone row."""

import json
import logging
from typing import Any

from claude_agent_sdk import tool, create_sdk_mcp_server

from db import get_pool
from .prompts import AMP_MODELS, EFFECTS

logger = logging.getLogger(__name__)

ALLOWED_AMP_NAMES: set[str] = {name for name, _desc in AMP_MODELS}
ALLOWED_EFFECTS: dict[str, set[str]] = {
    cat: set(names) for cat, names in EFFECTS.items()
}
ALLOWED_PATCH_KEYS: set[str] = {
    "name",
    "amp_model",
    "effects",
    "song_name",
    "artist_name",
    "notes",
}


def _row_to_dict(row) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in dict(row).items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, str) and k == "effects":
            # effects may come back as a JSON string depending on codec config
            try:
                out[k] = json.loads(v)
            except json.JSONDecodeError:
                logger.warning(
                    "Malformed effects JSON on tone row; treating as empty"
                )
                out[k] = {}
        else:
            out[k] = v
    return out


async def db_get_tone(tone_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM tones WHERE id = $1::uuid", tone_id)
        if not row:
            return None
        return _row_to_dict(row)


async def db_update_tone(tone_id: str, patch: dict) -> dict:
    # Filter to allowed keys only
    patch = {k: v for k, v in patch.items() if k in ALLOWED_PATCH_KEYS}
    if not patch:
        raise ValueError("No valid fields in patch")

    # Validate amp_model
    if "amp_model" in patch and patch["amp_model"] not in ALLOWED_AMP_NAMES:
        raise ValueError(
            f"Unknown amp_model: {patch['amp_model']!r}. "
            f"Must be one of the 25 canonical amp names."
        )

    # Validate effects: must be a dict of {slot: name|null}
    if "effects" in patch:
        effects = patch["effects"]
        if not isinstance(effects, dict):
            raise ValueError("effects must be an object keyed by slot")
        for slot, value in effects.items():
            if slot not in ALLOWED_EFFECTS:
                raise ValueError(
                    f"Unknown effect slot: {slot!r}. "
                    f"Must be one of {sorted(ALLOWED_EFFECTS.keys())}"
                )
            if value is not None and value not in ALLOWED_EFFECTS[slot]:
                raise ValueError(
                    f"Unknown {slot} effect: {value!r}. "
                    f"Must be one of {sorted(ALLOWED_EFFECTS[slot])} or null."
                )

        # Merge with existing effects so partial patches don't clobber untouched slots
        current = await db_get_tone(tone_id)
        if current is None:
            raise ValueError("Tone not found")
        existing = current.get("effects") or {}
        if isinstance(existing, str):
            try:
                existing = json.loads(existing)
            except json.JSONDecodeError:
                logger.warning(
                    "Malformed effects JSON on tone %s; starting merge from empty",
                    tone_id,
                )
                existing = {}
        merged = dict(existing) if isinstance(existing, dict) else {}
        merged.update(effects)
        patch["effects"] = merged

    pool = await get_pool()
    async with pool.acquire() as conn:
        cols = list(patch.keys())
        set_clauses = ", ".join(f"{col} = ${i+2}" for i, col in enumerate(cols))
        values: list[Any] = []
        for col in cols:
            v = patch[col]
            if col == "effects":
                values.append(json.dumps(v))
            else:
                values.append(v)
        sql = (
            f"UPDATE tones SET {set_clauses}, updated_at = now() "
            f"WHERE id = $1::uuid RETURNING *"
        )
        row = await conn.fetchrow(sql, tone_id, *values)
        if not row:
            raise ValueError("Tone not found")
        return _row_to_dict(row)


def make_tone_tools(tone_id: str):
    """Build an SDK MCP server with tools bound to a specific tone_id."""

    @tool(
        "get_tone",
        (
            "Read the current state of the tone being edited. Returns the amp "
            "model, effects chain, song/artist metadata, and notes. Always "
            "call this first in a turn before deciding what to change."
        ),
        {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    )
    async def get_tone_tool(args: dict) -> dict:
        try:
            tone = await db_get_tone(tone_id)
            if tone is None:
                return {
                    "content": [
                        {"type": "text", "text": "Error: tone not found"}
                    ]
                }
            return {
                "content": [
                    {"type": "text", "text": json.dumps(tone, default=str)}
                ]
            }
        except Exception as e:
            logger.exception("get_tone_tool failed")
            return {"content": [{"type": "text", "text": f"Error: {e}"}]}

    @tool(
        "update_tone",
        (
            "Patch the tone being edited. Send ONLY the fields you want to "
            "change — omitted fields are left alone. `effects` is a partial "
            "dict keyed by slot (stompbox, modulation, delay, reverb); each "
            "slot value must be an exact effect name from the catalog or "
            "null to clear it. `amp_model` must exactly match one of the 25 "
            "canonical amp names."
        ),
        {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Human-readable preset name.",
                },
                "amp_model": {
                    "type": "string",
                    "description": "Exact amp name from the catalog.",
                },
                "effects": {
                    "type": "object",
                    "description": (
                        "Partial effects chain. Keys: stompbox, modulation, "
                        "delay, reverb. Values: exact effect name or null."
                    ),
                    "properties": {
                        "stompbox": {"type": ["string", "null"]},
                        "modulation": {"type": ["string", "null"]},
                        "delay": {"type": ["string", "null"]},
                        "reverb": {"type": ["string", "null"]},
                    },
                    "additionalProperties": False,
                },
                "song_name": {"type": "string"},
                "artist_name": {"type": "string"},
                "notes": {"type": "string"},
            },
            "additionalProperties": False,
        },
    )
    async def update_tone_tool(args: dict) -> dict:
        try:
            updated = await db_update_tone(tone_id, args)
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Updated: {json.dumps(updated, default=str)}",
                    }
                ]
            }
        except ValueError as e:
            return {"content": [{"type": "text", "text": f"Error: {e}"}]}
        except Exception as e:
            logger.exception("update_tone_tool failed")
            return {"content": [{"type": "text", "text": f"Error: {e}"}]}

    return create_sdk_mcp_server(
        "tone", "1.0.0", tools=[get_tone_tool, update_tone_tool]
    )
