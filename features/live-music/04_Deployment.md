# Live Music NYC Deployment Notes

## Ticketmaster Credentials

Add these environment variables in Vercel:

- `TICKETMASTER_API_KEY`: Ticketmaster Consumer Key. This is the only credential required for the public Discovery API MVP; the app sends it as the Discovery API `apikey` query parameter from server-side Next API routes.

In Vercel, add them under:

1. Project Settings
2. Environment Variables
3. Add the variables for Production.
4. Also add them for Preview if you want branch/PR deployments to work.
5. Redeploy after saving environment variables.

For local development, add the same keys to `.env.local`.

Do not add a `NEXT_PUBLIC_` Ticketmaster key. Do not add Ticketmaster values to `backend/.env` for this MVP; the planned implementation uses Vercel/Next.js API routes, not the AWS Python backend.

The Ticketmaster Consumer Secret is not needed for the Discovery API MVP. If future Ticketmaster OAuth endpoints are added, store the Consumer Secret server-side only.

## Rate Limits

Ticketmaster Public APIs:

- 5000 requests per day
- 5 requests per second

Ticketmaster OAuth Product:

- 100 requests per minute

The MVP uses only public Discovery API calls, so implementation should optimize around the 5000/day and 5/sec limits. Keep all calls server-side, cache responses briefly, and cap top-artist fanout.
