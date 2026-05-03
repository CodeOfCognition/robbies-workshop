"""Shared asyncpg connection pool for the Supabase Postgres database."""

import os
import asyncpg

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL", "")

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not SUPABASE_DB_URL:
            raise RuntimeError("SUPABASE_DB_URL env var is not set")
        # Supabase's pooler runs in transaction mode, which breaks asyncpg's
        # default prepared-statement cache (DuplicatePreparedStatementError).
        # Disabling the cache keeps queries simple and stateless.
        _pool = await asyncpg.create_pool(
            SUPABASE_DB_URL,
            min_size=1,
            max_size=5,
            statement_cache_size=0,
        )
    return _pool
