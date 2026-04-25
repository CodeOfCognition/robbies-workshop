-- Run this in the Supabase SQL Editor (or via psql against SUPABASE_DB_URL)
-- before using the Interview applet's Supabase-backed persistence.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    resume JSONB,
    memories JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    company TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    posting TEXT NOT NULL DEFAULT '',
    research TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_profile_id_created_at
    ON jobs (profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS interviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('hr', 'hm', 'other')),
    title TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'done',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    questions INTEGER NOT NULL DEFAULT 0,
    transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
    feedback TEXT,
    proposed_memories JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interviews_profile_id_created_at
    ON interviews (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_interviews_job_id
    ON interviews (job_id);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
-- No public access policies = data is only accessible via service key.
