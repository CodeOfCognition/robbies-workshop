-- Run this in the Supabase SQL Editor (or via psql against SUPABASE_DB_URL)
-- before using the ToneBoard Supabase-backed persistence.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    amp_model TEXT NOT NULL,
    effects JSONB NOT NULL DEFAULT jsonb_build_object(
        'stompbox', NULL,
        'modulation', NULL,
        'delay', NULL,
        'reverb', NULL
    ),
    song_name TEXT,
    artist_name TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tone_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tone_id UUID NOT NULL REFERENCES tones(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tone_messages_tone_id_created_at
    ON tone_messages (tone_id, created_at);

ALTER TABLE tones ENABLE ROW LEVEL SECURITY;
ALTER TABLE tone_messages ENABLE ROW LEVEL SECURITY;
-- No public access policies = data is only accessible via service key.
