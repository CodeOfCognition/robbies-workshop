# Robbie's Workshop

Personal Swiss Army knife PWA — a single authenticated shell hosting multiple independent apps (ToneBoard, Transcriber, and more). Add to home screen for a native app experience.

## Stack

- **Frontend**: Next.js 15 + React 19 + Tailwind 4 (deployed on Vercel)
- **Backend**: Python 3.12 + FastAPI + Anthropic SDK (deployed on AWS App Runner)
- **Data**: Supabase Postgres
- **Auth**: NextAuth v5 with GitHub OAuth (whitelisted)

## Local Development

Both frontend and backend run on `localhost`, connected to the real Supabase DB.

### Prerequisites

- Node 20+ and Python 3.12+
- A **dev** GitHub OAuth app (separate from prod — don't reuse the production one):
  - https://github.com/settings/developers → **New OAuth App**
  - Homepage URL: `http://localhost:3000`
  - Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

### Environment files

**Backend** — copy and fill in:
```bash
cp backend/.env.example backend/.env
```
Required: `OPENAI_API_KEY`, `CLAUDE_API_KEY`, `SUPABASE_DB_URL`, `WORKSHOP_BACKEND_API_KEY` (any value, e.g. `dev-local-secret`).

**Frontend** — copy and fill in:
```bash
cp .env.example .env.local
```
Required:
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` — from the dev OAuth app above
- `AUTH_SECRET` — generate with `openssl rand -base64 32`
- `BACKEND_URL=http://localhost:8000`
- `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000`
- `WORKSHOP_BACKEND_API_KEY` — **must match** the backend value
- `NEXT_PUBLIC_WORKSHOP_BACKEND_API_KEY` — same shared secret
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — from the Supabase dashboard

> The `WORKSHOP_BACKEND_API_KEY` is a shared bearer token. Any mismatch between frontend and backend values will 401 every proxied call — this is the most common setup mistake.

### Install dependencies

```bash
# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# Frontend
npm install
```

### Run (two terminals)

**Terminal 1 — backend** (port `8000` locally; prod App Runner uses `8080` — intentional):
```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend**:
```bash
npm run dev
```

Open http://localhost:3000.

### Smoke tests

- `curl http://localhost:8000/health` → `{"status":"ok",...}`
- Visit http://localhost:3000, sign in with GitHub, confirm you land authenticated
- Open a ToneBoard tone and send a chat message (exercises frontend → Supabase → backend agent → Anthropic)

> ⚠️ Local backend writes to the **real** Supabase DB. Be mindful with destructive testing.

## Deploy

- **Frontend**: push to `main` → Vercel auto-deploys
- **Backend**: push to `main` with changes under `backend/` → GitHub Actions builds and pushes to ECR → App Runner picks up `latest`
