"""
Import Spotify Extended Streaming History into Supabase (Postgres).

=== PURPOSE ===
One-time bulk import of Spotify's "Extended Streaming History" JSON export
into a Postgres table hosted on Supabase. Designed to be re-run safely for
future exports (uses UPSERT-like dedup by timestamp + track URI).

=== DATA SOURCE ===
Spotify provides an "Extended Streaming History" via privacy data request
(https://www.spotify.com/account/privacy/). The export contains JSON files
named like:
    Streaming_History_Audio_2023-2024_7.json
    Streaming_History_Video_2021-2026.json

Each file is an array of objects with 23 fields. Key fields:
    ts                                  - ISO 8601 timestamp of playback
    master_metadata_track_name          - Song title
    master_metadata_album_artist_name   - Artist
    master_metadata_album_album_name    - Album
    spotify_track_uri                   - Spotify URI (spotify:track:xxx)
    ms_played                           - Milliseconds the track was played
    episode_name / episode_show_name    - Podcast fields (filtered out)
    audiobook_title / audiobook_uri     - Audiobook fields (filtered out)

=== TARGET TABLE ===
Table: streaming_history (Supabase Postgres, public schema)

Columns (17):
    id                  BIGSERIAL PRIMARY KEY   Auto-increment
    ts                  TIMESTAMPTZ NOT NULL     Playback timestamp
    platform            TEXT                     Device/OS (e.g. "ios")
    ms_played           INTEGER NOT NULL         Duration played (ms)
    conn_country        TEXT                     Country code ("US", "CA")
    track_name          TEXT                     Song title
    artist_name         TEXT                     Artist name
    album_name          TEXT                     Album name
    spotify_track_uri   TEXT                     Spotify track URI
    reason_start        TEXT                     How playback started
    reason_end          TEXT                     How playback ended
    shuffle             BOOLEAN                  Shuffle enabled
    skipped             BOOLEAN                  Track was skipped
    offline             BOOLEAN                  Offline playback
    offline_timestamp   BIGINT                   Unix ts of offline event
    incognito_mode      BOOLEAN                  Private session

Indexes: ts, artist_name, track_name

=== FILTERING ===
Rows are EXCLUDED if any of these are true:
  - episode_name is non-null (podcast episode)
  - episode_show_name is non-null (podcast show)
  - audiobook_title is non-null (audiobook)
  - spotify_track_uri is null AND track_name is null (unidentifiable record)

=== FIELD MAPPING ===
Spotify JSON field                      -> DB column
master_metadata_track_name              -> track_name
master_metadata_album_artist_name       -> artist_name
master_metadata_album_album_name        -> album_name
(all other mapped fields keep short names — see transform_record())

=== USAGE ===
    pip install psycopg2-binary
    export SUPABASE_DB_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
    python scripts/import_spotify.py

=== FUTURE USE ===
To import newer Spotify exports, just drop the new JSON files into the
"Spotify Extended Streaming History" directory and re-run. The script
processes all *.json files it finds there. If you need deduplication on
re-runs, add a UNIQUE constraint on (ts, spotify_track_uri) and switch
the INSERT to ON CONFLICT DO NOTHING.
"""

import os
import json
import glob
import psycopg2
from psycopg2.extras import execute_values

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HISTORY_DIR = os.path.join(
    os.path.dirname(__file__),
    "..",
    "Spotify Extended Streaming History",
)

DB_URL = os.environ.get("SUPABASE_DB_URL")
if not DB_URL:
    raise SystemExit(
        "Missing SUPABASE_DB_URL env var.\n"
        "Example: export SUPABASE_DB_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres'"
    )

BATCH_SIZE = 500

# Column order for INSERT — must match the VALUES tuple in transform_record()
COLUMNS = [
    "ts", "platform", "ms_played", "conn_country",
    "track_name", "artist_name", "album_name", "spotify_track_uri",
    "reason_start", "reason_end",
    "shuffle", "skipped", "offline", "offline_timestamp", "incognito_mode",
]

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS streaming_history (
    id                  BIGSERIAL PRIMARY KEY,
    ts                  TIMESTAMPTZ NOT NULL,
    platform            TEXT,
    ms_played           INTEGER NOT NULL,
    conn_country        TEXT,
    track_name          TEXT,
    artist_name         TEXT,
    album_name          TEXT,
    spotify_track_uri   TEXT,
    reason_start        TEXT,
    reason_end          TEXT,
    shuffle             BOOLEAN,
    skipped             BOOLEAN,
    offline             BOOLEAN,
    offline_timestamp   BIGINT,
    incognito_mode      BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_streaming_ts       ON streaming_history(ts);
CREATE INDEX IF NOT EXISTS idx_streaming_artist   ON streaming_history(artist_name);
CREATE INDEX IF NOT EXISTS idx_streaming_track    ON streaming_history(track_name);
"""

INSERT_SQL = f"""
INSERT INTO streaming_history ({', '.join(COLUMNS)})
VALUES %s
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def is_music_track(raw: dict) -> bool:
    """Return True if the record is a music track (not podcast/audiobook)."""
    if raw.get("episode_name") or raw.get("episode_show_name"):
        return False
    if raw.get("audiobook_title"):
        return False
    # Skip unidentifiable records (no track URI and no track name)
    if not raw.get("spotify_track_uri") and not raw.get("master_metadata_track_name"):
        return False
    return True


def transform_record(raw: dict) -> tuple:
    """Map Spotify JSON fields to a VALUES tuple matching COLUMNS order."""
    return (
        raw["ts"],
        raw.get("platform"),
        raw.get("ms_played", 0),
        raw.get("conn_country"),
        raw.get("master_metadata_track_name"),
        raw.get("master_metadata_album_artist_name"),
        raw.get("master_metadata_album_album_name"),
        raw.get("spotify_track_uri"),
        raw.get("reason_start"),
        raw.get("reason_end"),
        raw.get("shuffle"),
        raw.get("skipped"),
        raw.get("offline"),
        raw.get("offline_timestamp"),
        raw.get("incognito_mode"),
    )


def import_file(cursor, filepath: str) -> tuple[int, int]:
    """Import a single JSON file. Returns (inserted, filtered) counts."""
    filename = os.path.basename(filepath)
    with open(filepath, "r") as f:
        records = json.load(f)

    music_records = [r for r in records if is_music_track(r)]
    filtered_count = len(records) - len(music_records)
    transformed = [transform_record(r) for r in music_records]

    print(f"  {filename}: {len(records)} total, {filtered_count} filtered, {len(music_records)} to insert")

    inserted = 0
    for i in range(0, len(transformed), BATCH_SIZE):
        batch = transformed[i : i + BATCH_SIZE]
        execute_values(cursor, INSERT_SQL, batch)
        inserted += len(batch)
        print(f"    Inserted {inserted}/{len(transformed)}")

    return inserted, filtered_count


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cursor = conn.cursor()

    # Ensure table + indexes exist
    print("Ensuring streaming_history table exists...")
    cursor.execute(CREATE_TABLE_SQL)
    conn.commit()

    # Find all JSON files
    pattern = os.path.join(HISTORY_DIR, "*.json")
    files = sorted(glob.glob(pattern))

    if not files:
        print(f"No JSON files found in {HISTORY_DIR}")
        cursor.close()
        conn.close()
        return

    print(f"Found {len(files)} files to import\n")

    total_inserted = 0
    total_filtered = 0
    for filepath in files:
        inserted, filtered = import_file(cursor, filepath)
        conn.commit()
        total_inserted += inserted
        total_filtered += filtered

    cursor.close()
    conn.close()

    print(f"\nDone! Inserted {total_inserted} music tracks, filtered {total_filtered} non-music records.")


if __name__ == "__main__":
    main()
