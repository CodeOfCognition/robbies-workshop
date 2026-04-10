# CLAUDE.md

**Repo path:** `/Users/robdow/repos/robbies-workshop`

## Project Overview

This is a personal Swiss Army knife PWA — a single authenticated shell that hosts multiple independent apps. Designed for use on both phone and desktop. New app ideas get added here over time.

## Current Apps

- **ToneBoard** — Guitar amp preset builder for the Fender Mustang Micro Plus. Visual signal chain, amp/effects selection, AI-powered tone suggestions.
- **Transcriber** — Speech-to-text utility using OpenAI Whisper. Being reworked to support long recordings via the AWS backend (Vercel has body size and timeout limits that break multi-minute audio).
- **Spotify** (planned) — Separate sub-app for interfacing with personal Spotify data.

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript — deployed on Vercel
- **Backend (AI)**: Python, FastAPI, LangGraph — deployed on AWS
- **Data**: Supabase (Spotify data and application data)
- **Auth**: NextAuth.js v5 with GitHub OAuth, user whitelisting via `ALLOWED_GITHUB_ID`
- **PWA**: Service worker, manifest, offline support

## Security

Security is a priority. The app is gated behind GitHub OAuth with an explicit user whitelist. The auth provider may change in the future — keep the auth layer modular and don't couple app logic tightly to GitHub-specific details.

## AI Agents

All AI agents must be built in **LangGraph (Python)**. This is a separate service from the Next.js frontend and requires its own deployment. **AWS is the deployment target** — any Cloud Run or ToneBoard references in env vars or infra are legacy naming. The backend also handles heavy processing (e.g., long audio transcription) that exceeds Vercel's serverless limits. CI/CD uses **GitHub Actions → ECR → App Runner** (not CodeBuild).

## Infrastructure

| Layer | Service |
|-------|---------|
| Frontend | Vercel |
| AI Backend | AWS (Python/FastAPI/LangGraph) |
| Database | Supabase |

## Work in Progress

At any given time, parts of the codebase may be half-complete or out of compliance with these guidelines. That means they're **on hold**, not broken. Don't "fix", refactor, or remove things that look incomplete without asking first.

## GitHub Integration
You have access to the GitHub MCP. Use this to maintain commits, branches, and PRs. Note that every time you push to main though, it will redeploy the app.

## Collaboration Style

The owner is an experienced developer and AI engineer. When working on this project:

- **Present options and tradeoffs** for key architecture decisions — don't make big calls autonomously.
- **Agent design is hands-on** — the owner wants to be deeply involved in designing and iterating on AI agents. Don't scaffold or stub out agent logic without discussion.
- For routine implementation work, move fast and be direct. Save the back-and-forth for decisions that matter.
- **Learning Matters** - The owner is new to AWS and usually uses GCP. As they are learning, provide additional context about GCP equivalents, or a bit of detail on AWS services as they're being implemented. Keep it concise and relevant to the task at hand.

## Maintaining This File

Update this file prudently and with care. Keep it concise. As the project evolves, add relevant context, but don't let it bloat. Every section should earn its place.
