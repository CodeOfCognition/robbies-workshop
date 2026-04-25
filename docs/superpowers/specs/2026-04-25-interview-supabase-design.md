# Interview Applet — Supabase Persistence (Phase 1)

**Date:** 2026-04-25
**Scope:** Replace the Interview applet's `localStorage` store with a Supabase-backed store for **profiles, jobs, and interviews data**. Conversation generation and feedback remain mocked client-side; mocked content is persisted to the DB so the read path is real.

## Goals

- Persist profiles, jobs, and interviews across devices and sessions instead of `localStorage`.
- Match the patterns already in the repo (`tones` table, `/api/tones/*` routes, `src/lib/supabase.ts` server client, snake_case ↔ camelCase mapper).
- Multi-profile-ready: each profile is the unit of ownership in the app domain. A single authenticated GitHub user (today, just `CodeOfCognition`) can own multiple profiles. When GitHub multi-tenancy lands later, it's a single column add on `profiles`.

## Non-goals

- No real AI agent for conversation generation or feedback yet — the existing client-side mock continues to run, and its output is what gets persisted.
- No file-content storage for resumes — only the existing `{name, size, ext}` metadata blob is stored.
- No real-time sync, no optimistic-UI rework, no offline mode beyond what the service worker already provides.
- No removal of the existing in-memory state machine — the React component still drives UI from a single `Store` value; the difference is where that value is loaded from and saved to.

## Schema

Three tables. Nested arrays (`memories`, `transcript`, `proposed_memories`) live as JSONB on the parent row. Justification: this is a single-tenant app today, all access patterns load nested data with the parent, and Postgres JSONB matches the current shape directly. Same pattern as `tones.effects`.

### `profiles`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` default |
| `name` | text not null | |
| `resume` | jsonb null | `{name, size, ext}` or null |
| `memories` | jsonb not null default `'[]'::jsonb` | array of `{id, text, createdAt}` |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | bumped by API on every write |

### `jobs`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `profile_id` | uuid not null references `profiles(id)` on delete cascade | |
| `company` | text not null default `''` | |
| `role` | text not null default `''` | |
| `url` | text not null default `''` | |
| `posting` | text not null default `''` | markdown |
| `research` | text not null default `''` | markdown |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | |

Index: `(profile_id, created_at desc)` for the jobs list view.

### `interviews`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `profile_id` | uuid not null references `profiles(id)` on delete cascade | |
| `job_id` | uuid not null references `jobs(id)` on delete cascade | |
| `type` | text not null check in (`'hr'`, `'hm'`, `'other'`) | |
| `title` | text not null default `''` | |
| `notes` | text not null default `''` | |
| `status` | text not null default `'done'` | freeform for now |
| `duration_ms` | integer not null default 0 | |
| `questions` | integer not null default 0 | |
| `transcript` | jsonb not null default `'[]'::jsonb` | array of `{role, text}` |
| `feedback` | text null | markdown; null until interview completes |
| `proposed_memories` | jsonb null | array of `{id, text, state, memId?}` or null |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | |

Indexes: `(profile_id, created_at desc)` for the interviews list, `(job_id)` for "interviews on this job".

### Row-level security

Same as `tones`: RLS enabled with no public policies. All access goes through `/api/interview/*` routes that authenticate via NextAuth middleware and use `SUPABASE_SERVICE_ROLE_KEY` server-side.

## API surface

New route handlers under `src/app/api/interview/`. Following the `tones` pattern: thin handlers, snake_case wire shapes, mapper module shared with the client.

| Route | Methods | Purpose |
|---|---|---|
| `/api/interview/profiles` | `GET`, `POST` | List all profiles · create profile |
| `/api/interview/profiles/[id]` | `GET`, `PATCH`, `DELETE` | Read · update (name/resume/memories) · delete (cascades) |
| `/api/interview/jobs` | `GET`, `POST` | List jobs (filter `?profile_id=…`) · create job |
| `/api/interview/jobs/[id]` | `GET`, `PATCH`, `DELETE` | Read · update · delete (cascades) |
| `/api/interview/interviews` | `GET`, `POST` | List interviews (filter `?profile_id=…`) · create interview |
| `/api/interview/interviews/[id]` | `GET`, `PATCH`, `DELETE` | Read · update · delete |

`PATCH` accepts a partial body of the wire shape; the mapper translates to DB columns. `updated_at` is set explicitly on every PATCH so we don't depend on a trigger.

`POST /api/interview/interviews` accepts the full record (mocked transcript and feedback included) — the client-side mock generator runs first, then the result is persisted in one write. Later we swap the generator for a real backend call without changing this contract.

## Client integration

- New file `src/lib/interview-store.ts` — async client API: `listProfiles`, `getProfile`, `createProfile`, `updateProfile`, `deleteProfile`, and the same shape for jobs and interviews. All `fetch` calls to `/api/interview/*`. Mirrors `src/lib/store.ts` (the tones client store).
- New file `src/lib/interview-mapper.ts` — `ProfileRow`, `JobRow`, `InterviewRow`, plus `rowToProfile`, `rowToJob`, `rowToInterview`, `profilePatchToRow`, etc. Shared between API routes and the client store. Mirrors `src/lib/tones-mapper.ts`.
- `src/app/interview/page.tsx`:
  - On mount: if `interview.store.v4` exists in localStorage, ignore it (DB is authoritative). Replace `useState<Store>` initializer with empty default; load from API in a `useEffect`.
  - First-load empty state: if no profiles exist server-side, render a "Create your first profile" CTA instead of seeding fictional data. (Cleaner than auto-importing the demo seed.)
  - All mutations (`addJob`, `updateJob`, `deleteJob`, `addProfile`, `updateProfile`, `setActiveProfile`, the new-interview flow, `handleAcceptMemory`, `handleRejectMemory`) become async and call the new client API. UI optimistically updates local state, rolls back on error.
  - `activeProfileId` keeps living in localStorage (it's UI state, not data).
  - `interview.store.v4` localStorage entry is no longer read or written.

## Migration / bootstrap

- The seed data (`buildDefaultStore`) is removed from runtime code paths. We keep a one-time bootstrap script (`scripts/seed_interview_demo.ts`) that POSTs the existing seed (Robbie + 2 jobs + 1 interview) through the API. You can run it once to get back to the demo state, or skip it and start fresh.
- No automatic localStorage → DB migration. The current `localStorage` data is fictional/demo (no real interviews completed yet), so importing it has no value.

## File layout

```
scripts/
  create_interview_tables.sql        ← new; you run in Supabase SQL Editor
  seed_interview_demo.ts             ← new; optional one-time seed via API
src/
  app/
    api/
      interview/                     ← new
        profiles/
          route.ts
          [id]/route.ts
        jobs/
          route.ts
          [id]/route.ts
        interviews/
          route.ts
          [id]/route.ts
    interview/
      page.tsx                       ← edited: localStorage → API
  lib/
    interview-mapper.ts              ← new
    interview-store.ts               ← new
```

## Open questions / future work (not in scope)

- **Auth multi-tenancy.** When the whitelist grows beyond one user, add `auth_user_id text` to `profiles` only and filter list/create endpoints by it. The other tables FK to `profiles` so they inherit the scoping.
- **Real conversation + feedback agents.** Once the AI backend supports these, swap the client-side mock generator for a backend call before the POST to `/api/interview/interviews`. Schema is already shaped to receive the real output.
- **Resume file storage.** When real upload is wanted, add a `storage_path` field on the `resume` JSONB and a Supabase Storage bucket. The metadata shape is forward-compatible.
- **Soft delete / archive.** Not needed today; cascade-delete is fine for the volumes involved.

## What you'll have to do manually

Two things, both copy-paste:

1. Run `scripts/create_interview_tables.sql` in the Supabase SQL Editor (same flow as `create_tones_tables.sql`).
2. Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in `.env.local` (already required by the tones routes).

Optionally, run `scripts/seed_interview_demo.ts` if you want the demo data back.
