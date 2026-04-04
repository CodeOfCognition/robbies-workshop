# AWS Backend Setup — Status & Next Steps

**Last updated:** 2026-04-04, 11:11AM

## What's Done

### GitHub Migration (complete)
- Repo moved to `CodeOfCognition/robbies-workshop`
- All git history rewritten — no traces of old account
- Local git config set to CodeOfCognition for this repo
- `gh auth` has both accounts; CodeOfCognition is active
- Codebase references updated (auth.ts, .env.example, CORS origin, manifest, layout)

### Vercel (complete)
- Reconnected to `CodeOfCognition/robbies-workshop`
- Env vars updated (`AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `ALLOWED_GITHUB_ID`)
- GitHub OAuth App created under CodeOfCognition
- App is live at `https://robbies-workshop.vercel.app`

### AWS Resources Created
- **ECR repo:** `robbies-workshop-backend` (empty, no images yet)
  - URI: `223249276857.dkr.ecr.us-east-1.amazonaws.com/robbies-workshop-backend`
- **CodeBuild project:** `robbies-workshop-backend`
  - Source: `https://github.com/CodeOfCognition/robbies-workshop.git`
  - Uses `buildspec.yml` at repo root
  - Builds from `backend/Dockerfile`
- **IAM role:** `codebuild-robbies-workshop-role` with ECR push + CloudWatch logs permissions
- **buildspec.yml** committed to repo

### Backend Code
- `backend/agent.py` — LangGraph preset suggestion agent, updated to Gemini 3.1 Pro with low reasoning
- `backend/main.py` — FastAPI app with `/suggest-preset` and `/health` endpoints
- `backend/requirements.txt` — bumped `langchain-google-genai` to 4.2.1
- CORS set to `robbies-workshop.vercel.app` + `localhost:3000`

## What's Stuck

### CodeBuild Webhook (GitHub → auto-build on push)
The webhook that triggers CodeBuild on push to `main` failed to create. Root cause:

- AWS CodeConnections creates an **OAuth authorization** for the "AWS Connector for GitHub" app
- But the GitHub App is **not installed** on the CodeOfCognition account — only authorized
- Without installation, AWS can't create webhooks on the repo
- Attempting to install the app redirects to AWS with "connection is not in a PENDING state" error

**What was tried:**
1. Created CodeConnection via CLI, completed handshake in console — app authorized but not installed
2. Tried installing via `github.com/apps/aws-connector-for-github/installations/new` — redirected to AWS error
3. Deleted and recreated the connection — same result

**To resolve, try:**
1. Delete any existing CodeConnection in AWS console
2. Revoke "AWS Connector for GitHub" in GitHub → Settings → Applications
3. Create a new connection in AWS console
4. During the GitHub handshake, look for "Install & Authorize" (not just "Authorize")
5. If installation still fails, contact AWS support or try the CodeBuild direct OAuth method (Edit Source → "Connect to GitHub via OAuth")

**Fallback options:**
- GitHub Actions workflow that calls `aws codebuild start-build` on push to main
- Manual trigger: `aws codebuild start-build --project-name robbies-workshop-backend`

## Next Steps (in order)

### 1. Fix the webhook (or choose a fallback)
See above. Once resolved, pushing to `main` will auto-build and push to ECR.

### 2. First build + ECR image
Either fix the webhook and push, or trigger manually:
```bash
aws codebuild start-build --project-name robbies-workshop-backend --region us-east-1
```

### 3. Create App Runner service
Once an image exists in ECR, create the App Runner service:
- Source: ECR `robbies-workshop-backend:latest`
- Port: 8080
- Auto-deploy: enabled (redeploys when new image pushed to ECR)
- Environment variables needed:
  - `GOOGLE_API_KEY` — Gemini API key
  - `TONEBOARD_API_KEY` — shared secret for API auth
  - `ALLOWED_ORIGINS` — `https://robbies-workshop.vercel.app,http://localhost:3000`

### 4. Connect frontend to backend
- Update Vercel env vars to point to the App Runner URL (replace legacy `CLOUD_RUN_URL` / `CLOUD_RUN_API_KEY`)
- Frontend code may need updating to call the new backend URL

### 5. Test end-to-end
- Hit `/health` on the App Runner URL
- Test `/suggest-preset` with an API key
- Test from the frontend ToneBoard UI
