"""
Import Spotify Extended Streaming History into Supabase (Postgres).

Usage:
    pip install supabase
    export SUPABASE_URL="https://your-project.supabase.co"
    export SUPABASE_SERVICE_KEY="your-service-role-key"
    python scripts/import_spotify.py

This script:
1. Creates the streaming_history table if it doesn't exist
2. Reads all JSON files from the Spotify Extended Streaming History directory
3. Batch-inserts records into Supabase
"""

import os
import json
import glob
from supabase import create_client

HISTORY_DIR = os.path.join(
    os.path.dirname(__file__),
    "..",
    "Spotify Extended Streaming History",
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

BATCH_SIZE = 500


def create_table(supabase):
    """Create the streaming_history table via Supabase SQL editor.

    Run this SQL in the Supabase dashboard SQL Editor before importing:
    """
    sql = """
    CREATE TABLE IF NOT EXISTS streaming_history (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL,
        platform TEXT,
        ms_played INTEGER NOT NULL,
        conn_country TEXT,
        ip_addr TEXT,
        track_name TEXT,
        artist_name TEXT,
        album_name TEXT,
        spotify_track_uri TEXT,
        episode_name TEXT,
        episode_show_name TEXT,
        spotify_episode_uri TEXT,
        audiobook_title TEXT,
        audiobook_uri TEXT,
        audiobook_chapter_uri TEXT,
        audiobook_chapter_title TEXT,
        reason_start TEXT,
        reason_end TEXT,
        shuffle BOOLEAN,
        skipped BOOLEAN,
        offline BOOLEAN,
        offline_timestamp BIGINT,
        incognito_mode BOOLEAN
    );

    -- Indexes for common query patterns
    CREATE INDEX IF NOT EXISTS idx_streaming_ts ON streaming_history(ts);
    CREATE INDEX IF NOT EXISTS idx_streaming_artist ON streaming_history(artist_name);
    CREATE INDEX IF NOT EXISTS idx_streaming_track ON streaming_history(track_name);
    CREATE INDEX IF NOT EXISTS idx_streaming_platform ON streaming_history(platform);
    """
    print("Running table creation SQL...")
    supabase.postgrest.schema("public")
    result = supabase.rpc("exec_sql", {"query": sql}).execute()
    return result


def transform_record(raw: dict) -> dict:
    """Map Spotify JSON field names to our DB column names."""
    return {
        "ts": raw["ts"],
        "platform": raw.get("platform"),
        "ms_played": raw.get("ms_played", 0),
        "conn_country": raw.get("conn_country"),
        "ip_addr": raw.get("ip_addr"),
        "track_name": raw.get("master_metadata_track_name"),
        "artist_name": raw.get("master_metadata_album_artist_name"),
        "album_name": raw.get("master_metadata_album_album_name"),
        "spotify_track_uri": raw.get("spotify_track_uri"),
        "episode_name": raw.get("episode_name"),
        "episode_show_name": raw.get("episode_show_name"),
        "spotify_episode_uri": raw.get("spotify_episode_uri"),
        "audiobook_title": raw.get("audiobook_title"),
        "audiobook_uri": raw.get("audiobook_uri"),
        "audiobook_chapter_uri": raw.get("audiobook_chapter_uri"),
        "audiobook_chapter_title": raw.get("audiobook_chapter_title"),
        "reason_start": raw.get("reason_start"),
        "reason_end": raw.get("reason_end"),
        "shuffle": raw.get("shuffle"),
        "skipped": raw.get("skipped"),
        "offline": raw.get("offline"),
        "offline_timestamp": raw.get("offline_timestamp"),
        "incognito_mode": raw.get("incognito_mode"),
    }


def import_file(supabase, filepath: str) -> int:
    """Import a single JSON file, returns number of records inserted."""
    filename = os.path.basename(filepath)
    with open(filepath, "r") as f:
        records = json.load(f)

    print(f"  {filename}: {len(records)} records")

    transformed = [transform_record(r) for r in records]

    # Batch insert
    inserted = 0
    for i in range(0, len(transformed), BATCH_SIZE):
        batch = transformed[i : i + BATCH_SIZE]
        supabase.table("streaming_history").insert(batch).execute()
        inserted += len(batch)
        print(f"    Inserted {inserted}/{len(transformed)}")

    return inserted


def main():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Find all JSON files
    pattern = os.path.join(HISTORY_DIR, "*.json")
    files = sorted(glob.glob(pattern))

    if not files:
        print(f"No JSON files found in {HISTORY_DIR}")
        return

    print(f"Found {len(files)} files to import\n")

    total = 0
    for filepath in files:
        count = import_file(supabase, filepath)
        total += count

    print(f"\nDone! Imported {total} total records.")


if __name__ == "__main__":
    main()
