-- The assembled system prompt is persisted on the first agent turn so
-- subsequent turns can reuse it without re-extracting the résumé. Backend-only;
-- not exposed to the frontend types. The candidate's "focus on…" instruction
-- to the agent reuses the existing `notes` column.

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS system_prompt TEXT;
