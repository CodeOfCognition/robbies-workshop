# Technical Requirements

## 1. Overview

### Feature Name

Live Music NYC

### Related PRD

`features/live-music/01_PRD.md`

### Summary

Add a new Next.js applet at `/live-music` that combines Supabase Spotify listening history with Ticketmaster Discovery API event and venue data. The MVP should keep all Ticketmaster API calls server-side, expose small JSON API routes to the client, normalize event/venue shapes for rendering, and persist saved venues in localStorage unless Supabase persistence is trivial during implementation.

## 2. Architecture Fit

### Affected Areas

- `src/app/page.tsx`: Add Live Music NYC to the app launcher.
- `src/app/live-music/page.tsx`: New client applet UI.
- `src/app/live-music/live-music.css`: Applet-specific styles.
- `src/app/api/live-music/top-artists/route.ts`: Return current-year top artists from Supabase.
- `src/app/api/live-music/for-you/route.ts`: Return upcoming NYC events by top artists.
- `src/app/api/live-music/events/route.ts`: Return broader upcoming NYC music events.
- `src/app/api/live-music/venues/[id]/events/route.ts`: Return upcoming events for a venue.
- `src/lib/live-music/ticketmaster.ts`: Server-only Ticketmaster client and response normalization.
- `src/lib/live-music/types.ts`: Shared TypeScript types safe for client/server.
- `src/lib/live-music/client-store.ts`: Client helpers and localStorage saved venue functions.
- `.env.example`: Add `TICKETMASTER_API_KEY`.

### Constraints

- Keep Ticketmaster API key server-side.
- Use the Ticketmaster Consumer Key as `TICKETMASTER_API_KEY`; do not use the Consumer Secret in the public Discovery API MVP.
- Respect Ticketmaster public Discovery API limits: 5000 requests per day and 5 requests per second.
- Treat the Ticketmaster OAuth product limit, 100 requests per minute, as future scope only.
- Use the existing Next.js applet pattern.
- Keep backend Python out of the MVP unless a clear blocker appears.
- Keep NYC hardcoded.
- Keep a 6-month event horizon.
- Avoid adding paid map providers or extra API keys.
- Preserve current public/no-auth state until the separate OAuth rollback happens.

## 3. Data Model

### Existing Inputs

- `streaming_history.artist_name`: Artist name from Spotify history.
- `streaming_history.ms_played`: Milliseconds listened.
- `streaming_history.ts`: Playback timestamp.
- `SUPABASE_URL`: Existing Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Existing server-side key for API routes.

### New or Changed Inputs

| Field | Type | Required | Source | Notes |
| --- | --- | --- | --- | --- |
| `TICKETMASTER_API_KEY` | string | Yes | Vercel/local env | Server-only. |
| `event.id` | string | Yes | Ticketmaster | Used for dedupe and links. |
| `event.name` | string | Yes | Ticketmaster | Display title. |
| `event.url` | string | No | Ticketmaster | Link to ticket page. |
| `event.dates.start.localDate` | string | No | Ticketmaster | Display date. |
| `event.dates.start.localTime` | string | No | Ticketmaster | Display time. |
| `event.priceRanges` | array | No | Ticketmaster | Display min-max when available. |
| `event._embedded.venues[0]` | object | No | Ticketmaster | Venue display and map. |
| `venue.location.latitude` | string | No | Ticketmaster | Map pin. |
| `venue.location.longitude` | string | No | Ticketmaster | Map pin. |

### Derived Values

| Value | Calculation | NYC Aware | Explainability Required |
| --- | --- | --- | --- |
| `topArtists` | `SUM(ms_played)` by artist for current year, top 100 | No | Yes |
| `forYouEvents` | Top-artist Ticketmaster event matches in NYC next 6 months | Yes | Yes |
| `allNycEvents` | Ticketmaster music events in Manhattan/Brooklyn/Queens next 6 months | Yes | No |
| `priceLabel` | `priceRanges` min-max currency or "Price unavailable" | No | No |
| `venuePins` | Unique venues with coordinates from event results | Yes | No |
| `savedVenues` | localStorage list keyed by Ticketmaster venue ID | Yes | No |

## 4. Business Logic Requirements

### Deterministic Rules

1. Top artists: Filter rows where `ts >= Jan 1 current year`, `artist_name IS NOT NULL`, and `artist_name <> ''`; group by artist; sort by total listening time descending; limit 100.
2. Event horizon: Use `startDateTime=now` and `endDateTime=now + 6 months`, formatted as UTC ISO strings compatible with Ticketmaster.
3. NYC filter: Query music events for city values `New York`, `Brooklyn`, and `Queens`, `stateCode=NY`, `countryCode=US`. Dedupe returned events by Ticketmaster event ID.
4. Personalized event matching: For MVP, search a capped subset of top artists, starting with the top 30, using Ticketmaster events with `keyword=<artist>`, `classificationName=music`, NYC filters, and 6-month date window. Auto-accept returned events; use attraction names to attach `matchedArtist` when possible.
5. Dedupe: If the same event appears from multiple artist searches, keep the earliest normalized copy and merge matched artist names.
6. Price: If `priceRanges` has min and max, display `$min-$max`; if only one value exists, display from that value; otherwise "Price unavailable."
7. Saved venues: Store and retrieve a compact venue object in localStorage under `liveMusic.savedVenues`.

### Event and Venue Behavior

- Only music events are in scope.
- Events without venues can render in lists but cannot appear on the map.
- Venues without coordinates should appear in venue lists but not as map pins.
- Saved venues remain visible even if their current event query returns no shows.

### Explainability

Each personalized event should include:

- Triggering condition: matched by top artist search.
- User-facing reason: "Because you listened to `<artist>` this year."
- Source data: Spotify current-year rank and Ticketmaster event attraction/keyword match where available.

## 5. UI Requirements

### Rendering Changes

- Home app launcher displays Live Music NYC.
- `/live-music` displays a sticky/header area with app title and four tab controls.
- For You tab displays personalized events sorted chronologically.
- NYC Shows tab displays general NYC music events sorted chronologically.
- Map tab displays venues from event results with mode toggle: liked artists vs all venues.
- Saved Venues tab displays saved venue cards and upcoming events per saved venue.

### Interaction Rules

- Tab controls must be keyboard accessible buttons.
- Save/unsave controls must work from event and venue cards.
- Empty states must name the specific missing data: no top artists, no Ticketmaster events, no saved venues, or no upcoming venue shows.
- Ticketmaster outbound links open in a new tab.

## 6. Error and Edge Case Handling

- Missing `TICKETMASTER_API_KEY`: API routes return `503` with `Ticketmaster is not configured`.
- Missing Supabase env: top-artists route returns `503` with `Supabase is not configured`.
- Ticketmaster 401/429/500: API route returns a concise error message and status.
- Empty top artists: For You tab shows a state explaining there is no current-year listening data.
- Missing price ranges: show "Price unavailable."
- Missing venue coordinates: exclude from map pins, keep event visible.

## 7. Performance Requirements

- Avoid browser-side fanout to Ticketmaster.
- Server routes should cap Ticketmaster page sizes and artist fanout for MVP.
- Use a short in-memory cache in `ticketmaster.ts` keyed by request URL, with a 10-minute TTL.
- Keep request bursts below 5 requests per second by limiting parallel artist searches or batching with a small concurrency limit.
- Normalize once per API response; do not repeatedly parse raw Ticketmaster objects in React render loops.

## 8. Accessibility Requirements

- Tabs must be real buttons with visible active state.
- Save venue buttons need clear labels such as "Save venue" and "Remove saved venue."
- Map pins must have text alternatives in a venue list below or beside the map.
- Event cards must not rely on color alone for date/price/venue meaning.
- Text must remain readable on phone and desktop.

## 9. Testing Requirements

### Unit Tests

If adding a test harness is feasible, add tests for:

- `formatPriceRange`
- `normalizeEvent`
- `extractVenue`
- `dedupeEvents`
- `saved venue localStorage serialization`

If no test harness is added during the MVP sprint, `npm run build` plus local browser/API verification is acceptable.

### Manual Tests

1. Run `npm run build`.
2. Run `npm run dev`.
3. Open `http://localhost:3000/live-music`.
4. Verify For You renders data or a useful empty/error state.
5. Verify NYC Shows renders data or a useful empty/error state.
6. Verify Map toggles between "Liked artists" and "All venues."
7. Save and unsave a venue.
8. Verify Saved Venues shows venue details and upcoming shows or a specific empty state.

## 10. Migration and Compatibility

### Fixture Migration

No fixture migration is required. Existing `streaming_history` remains the source of listening history.

### Backward Compatibility

- Existing applets and API routes must keep working.
- If localStorage saved venue data is malformed, ignore it and start with an empty saved venue list.

## 11. Security and Privacy

- Do not expose `TICKETMASTER_API_KEY` to the client.
- Do not expose `TICKETMASTER_CONSUMER_SECRET` to the client; do not use it unless a future OAuth product endpoint requires it.
- Do not send the full Spotify history to Ticketmaster; only artist names are used in server-side searches.
- Do not add trackers.
- Keep Supabase service-role access inside Next API routes only.

## 12. Open Technical Questions

- None blocking MVP. A later version can replace localStorage with Supabase persistence and improve artist-to-attraction matching.

## 13. Technical Decision Log

| Date | Decision | Owner | Notes |
| --- | --- | --- | --- |
| 2026-06-10 | Use Next API routes instead of Python backend for MVP. | Codex | Fastest integration with existing Supabase client and frontend. |
| 2026-06-10 | Use localStorage for saved venues unless Supabase proves equally fast. | Robbie/Codex | User approved easiest path. |
| 2026-06-10 | Use event-derived venues for map and venue views. | Codex | Avoid extra venue discovery complexity. |
| 2026-06-10 | Treat Ticketmaster Consumer Key as the only required MVP credential. | Codex | Discovery API uses `apikey`; Consumer Secret is future OAuth-only. |
