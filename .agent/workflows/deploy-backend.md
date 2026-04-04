---
description: How to deploy the ToneBoard backend to Cloud Run
---

// turbo-all

## Prerequisites
- `gcloud` CLI installed and authenticated
- A GCP project with billing enabled
- Your Gemini API key

## Steps

1. Set your GCP project:
```bash
gcloud config set project YOUR_PROJECT_ID
```

2. Enable required APIs:
```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com
```

3. Generate a shared API key (save this — you'll need it for both Cloud Run and Vercel):
```bash
openssl rand -base64 32
```

4. Clone the repo (if not already done):
```bash
git clone https://github.com/robbiedow/guitar-vibes.git
cd guitar-vibes
```

5. Deploy to Cloud Run from the backend directory:
```bash
cd backend
gcloud run deploy toneboard-api \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_API_KEY=YOUR_GEMINI_KEY,TONEBOARD_API_KEY=YOUR_SHARED_SECRET_FROM_STEP_3"
```

6. Get the Cloud Run service URL:
```bash
gcloud run services describe toneboard-api --region us-east1 --format 'value(status.url)'
```

7. Test the health endpoint:
```bash
curl $(gcloud run services describe toneboard-api --region us-east1 --format 'value(status.url)')/health
```

8. Test the suggest-preset endpoint:
```bash
CLOUD_RUN_URL=$(gcloud run services describe toneboard-api --region us-east1 --format 'value(status.url)')
curl -X POST "$CLOUD_RUN_URL/suggest-preset" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_SHARED_SECRET_FROM_STEP_3" \
  -d '{"song_name":"Back in Black","artist":"AC/DC"}'
```

9. Add env vars to Vercel (Settings → Environment Variables):
- `CLOUD_RUN_URL` = the URL from step 6
- `CLOUD_RUN_API_KEY` = the shared secret from step 3

10. Redeploy on Vercel (push a commit or trigger manual deploy).
