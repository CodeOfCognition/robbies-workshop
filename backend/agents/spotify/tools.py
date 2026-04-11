"""
Spotify agent tools — execute read-only SQL against the streaming_history table.
"""

import os
import json
import logging
import asyncpg

logger = logging.getLogger(__name__)

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL", "")

ROW_LIMIT = 500

# Lazy-initialized connection pool
_pool: asyncpg.Pool | None = None


async def _get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not SUPABASE_DB_URL:
            raise RuntimeError("SUPABASE_DB_URL env var is not set")
        _pool = await asyncpg.create_pool(SUPABASE_DB_URL, min_size=1, max_size=5)
    return _pool


async def execute_sql(sql: str) -> str:
    """Execute a read-only SQL query and return results as a JSON string."""
    normalized = sql.strip().rstrip(";").strip()

    # Reject multiple statements (prevent piggy-backed queries like "SELECT 1; DROP TABLE ...")
    if ";" in normalized:
        return json.dumps({"error": "Only single SQL statements are allowed."})

    if not normalized.upper().startswith("SELECT"):
        return json.dumps({"error": "Only SELECT queries are allowed."})

    # Enforce row limit if not already present
    upper = normalized.upper()
    if "LIMIT" not in upper:
        normalized = f"{normalized} LIMIT {ROW_LIMIT}"

    pool = await _get_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(normalized)
            results = [dict(row) for row in rows]

            # Convert non-serializable types (datetime, Decimal, etc.)
            for row in results:
                for key, value in row.items():
                    if hasattr(value, "isoformat"):
                        row[key] = value.isoformat()
                    elif isinstance(value, (bytes, memoryview)):
                        row[key] = str(value)

            return json.dumps(results, default=str)
    except Exception as e:
        logger.error(f"SQL execution error: {e}")
        return json.dumps({"error": str(e)})
