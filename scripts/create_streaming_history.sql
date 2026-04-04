-- Run this in the Supabase SQL Editor before running import_spotify.py

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

-- Enable Row Level Security (keep data private)
ALTER TABLE streaming_history ENABLE ROW LEVEL SECURITY;

-- Allow the service role to do everything (used by import script and backend)
-- No public access policies = data is only accessible via service key
