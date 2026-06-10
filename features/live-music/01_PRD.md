# Product Requirements Document

## 1. Overview

### Feature Name

Live Music NYC

### Summary

Live Music NYC is a new Robbie's Workshop applet for tracking upcoming concerts in New York City. It uses the user's current-year top Spotify artists from Supabase and Ticketmaster Discovery API event data to surface shows by artists the user already likes, browse upcoming NYC concerts, and inspect venues on a map.

The MVP matters now because the app already has Spotify listening history in Supabase and the Ticketmaster API docs/API shape are available. The first version should be fast, useful, and intentionally simple.

### Background

Robbie's Workshop is a personal PWA with independent applets under the authenticated/public shell. The app currently stores Spotify streaming history in Supabase Postgres table `streaming_history`, with rows from 2014-2026. Existing Spotify functionality uses backend SQL tooling, but this applet can ship faster with focused Next API routes that query Supabase directly and call Ticketmaster from the server.

Ticketmaster Discovery API V2 supports searching events, attractions, and venues. Event search supports `keyword`, `attractionId`, `venueId`, `city`, `stateCode`, `countryCode`, `classificationName`, `startDateTime`, `endDateTime`, `size`, `page`, and `sort`. Event responses may include `priceRanges`, venue data, attraction data, URLs, dates, and images. Price data is not guaranteed.

The Ticketmaster public Discovery API uses the Consumer Key as the `apikey` query parameter. The Consumer Secret belongs to Ticketmaster OAuth products and is not required for this MVP. Public Discovery API quota is 5000 requests per day and 5 requests per second; OAuth product quota is 100 requests per minute and should only matter if a later version adds OAuth-backed Ticketmaster endpoints.

## 2. Goals

### Business Goals

- Add a useful new applet to Robbie's Workshop quickly.
- Turn existing Spotify history into actionable live-music discovery.
- Keep the MVP small enough to build and verify in one short implementation session.

### User Goals

- See upcoming NYC shows by artists the user listened to most this year.
- Browse upcoming NYC music events in chronological order.
- See where relevant shows and venues are located.
- Save favorite venues and quickly view upcoming shows at those venues.

### Non-Goals

- No non-Ticketmaster ticket sources in V1.
- No AI agent, recommendation model, or natural language chat in V1.
- No multi-city support in V1.
- No ticket purchasing inside the app; link out to Ticketmaster.
- No guaranteed live ticket inventory or exact final checkout pricing.

## 3. Users and Use Cases

### Primary Users

- Robbie
- Friends or visitors using the temporarily public PWA
- Future authenticated user after OAuth is restored

### Key Use Cases

1. A music fan needs to see upcoming NYC shows by their top artists so they can decide which concerts to attend.
2. A music fan needs to browse upcoming NYC concerts chronologically so they can find things happening soon.
3. A music fan needs to inspect venues on a map so they can understand where shows are clustered.
4. A music fan needs to save venues so they can watch the calendars of places they already like.

## 4. Current Experience

The app has a Spotify chat applet that can answer questions about listening history, but there is no direct workflow for converting top artists into upcoming concert discovery. The user must manually ask about artists, search Ticketmaster separately, compare dates/prices, and remember preferred venues elsewhere.

### Pain Points

- Top Spotify artists are not connected to concert discovery.
- Ticketmaster search is broad and not personalized to listening history.
- Venue preference is not tracked inside Robbie's Workshop.
- NYC venue geography is hard to scan from a plain event list.

## 5. Proposed Experience

The user opens the Live Music NYC applet from the home page. The app defaults to "For You," showing upcoming Ticketmaster music events in New York City for the current calendar year's top 100 Spotify artists, sorted by date. Each event shows artist/event name, date/time, venue, borough/city, lowest-highest price range when available, and a Ticketmaster link.

The app includes additional views:

- "NYC Shows": upcoming music events in NYC regardless of listening history.
- "Map": venue pins with two modes: liked-artist venues and all venues with upcoming events.
- "Saved Venues": venues the user saved, with upcoming shows at each venue.

### User Flow

1. User lands on `/live-music`.
2. User reviews the "For You" list of upcoming shows by top artists.
3. User switches to "NYC Shows" to browse broader upcoming concerts.
4. User opens "Map" to see venue locations and toggles between liked-artist venues and all event venues.
5. User saves venues from event cards or venue cards.
6. User opens "Saved Venues" to view saved venues and their upcoming shows.

### UX Requirements

- The applet must be understandable without training.
- Ticket price must show a range when Ticketmaster provides one, and "Price unavailable" otherwise.
- Date, venue, and Ticketmaster link must be visible on event cards.
- Views must have useful empty states.
- The app must be hardcoded to New York City for V1.
- Loading and error states must be calm and actionable.

## 6. Functional Requirements

| ID | Requirement | Priority | Notes |
| --- | --- | --- | --- |
| FR-1 | Add a Live Music NYC applet route and home-page entry. | Must | Route: `/live-music`. |
| FR-2 | Query Supabase for current calendar year top 100 artists by total `ms_played`. | Must | Exclude null/blank `artist_name`. |
| FR-3 | Match top artists to Ticketmaster automatically. | Must | Use Ticketmaster attraction search or event keyword search; auto-pick best exact/strong match. |
| FR-4 | Show upcoming NYC music events for matched top artists over the next 6 months. | Must | Sort chronologically. |
| FR-5 | Show event price ranges when present and "Price unavailable" otherwise. | Must | Use `priceRanges`. |
| FR-6 | Show a broader NYC upcoming concerts view. | Must | Ticketmaster-only, music events, next 6 months. |
| FR-7 | Show a venue map view. | Should | Easiest acceptable MVP can use an embedded map library or lightweight coordinate plot. |
| FR-8 | Support two map modes: liked-artist venues and all venues with upcoming events. | Should | Use event-derived venue locations. |
| FR-9 | Allow saving and unsaving venues. | Must | Easiest acceptable persistence is localStorage; Supabase may be used if quick. |
| FR-10 | Show saved venues and upcoming shows at each saved venue. | Must | Use Ticketmaster event search by `venueId`. |
| FR-11 | Keep Ticketmaster API key server-side. | Must | Do not expose API key in client bundle. |
| FR-12 | Cache Ticketmaster responses briefly. | Should | Prevent excessive API calls during local use. |
| FR-13 | Respect Ticketmaster public API rate limits. | Must | Stay below 5 requests/sec and 5000/day; cap MVP fanout. |

## 7. Data Requirements

### Inputs

- `streaming_history.artist_name`: Spotify artist name.
- `streaming_history.ms_played`: Listening duration used for ranking.
- `streaming_history.ts`: Used to filter current calendar year.
- `TICKETMASTER_API_KEY`: Server-side API key.
- Ticketmaster Discovery event fields: `id`, `name`, `url`, `dates`, `priceRanges`, `_embedded.venues`, `_embedded.attractions`, `images`, `classifications`.
- Ticketmaster venue fields: `id`, `name`, `city`, `state`, `address`, `postalCode`, `location`.

### Outputs

- Ranked top artists for the year.
- Personalized event list.
- All NYC music event list.
- Venue list with event counts and saved status.
- Map pins for venues with coordinates.
- Saved venue list with upcoming events per venue.

### Data Shape Changes

MVP may avoid Supabase schema changes by storing saved venues in localStorage:

```json
{
  "liveMusic.savedVenues": [
    {
      "id": "KovZpZA7AAEA",
      "name": "Brooklyn Paramount",
      "city": "Brooklyn",
      "stateCode": "NY",
      "latitude": 40.689,
      "longitude": -73.981
    }
  ]
}
```

If Supabase persistence is chosen during implementation, add a `saved_venues` table with `ticketmaster_venue_id`, `name`, `city`, `state_code`, `latitude`, `longitude`, `created_at`.

## 8. Business Logic

### Rules

1. Current-year top artists: Filter `streaming_history.ts` from January 1 of the current year through now, group by `artist_name`, order by `SUM(ms_played)` descending, limit 100.
2. NYC scope: Query Ticketmaster for music events in New York City, Brooklyn, and Queens, NY. If this misses obvious NYC venue records, allow a Manhattan-centered radius fallback.
3. Event horizon: Include events from now through 6 months from now.
4. Personalized events: An event qualifies for "For You" if a matched top artist appears as an attraction or strong keyword match.
5. Price display: If any `priceRanges` exists, display min-max plus currency; otherwise display "Price unavailable."
6. Venue map modes: "Liked artists" uses venues from personalized events; "All venues" uses venues from the broader NYC event list.
7. Saved venue events: Fetch upcoming events by Ticketmaster `venueId` over the next 6 months.

### Explainability

For personalized event cards, show the reason as "Because you listened to `<artist>` this year" when a matched top artist is known. For venue cards, show "Saved venue" or "Venue with upcoming music events" depending on the source.

## 9. Edge Cases

- No Spotify listening history for the current year.
- Top artist has no Ticketmaster attraction match.
- Artist has no NYC shows in the next 6 months.
- Ticketmaster returns duplicate events across artist searches.
- Ticketmaster event has no `priceRanges`.
- Ticketmaster event has a venue without coordinates.
- Ticketmaster API rate limit or 401/500 errors.
- Saved venue has no upcoming shows.
- Browser localStorage unavailable.

## 10. Success Metrics

### Product Metrics

- User can see at least one loaded view in under a few seconds when APIs are healthy.
- User can save a venue and see it in Saved Venues.
- User can click through to Ticketmaster for an event.

### Quality Metrics

- `npm run build` succeeds.
- Local browser verification confirms `/live-music` loads without auth and renders the app shell.
- API route behavior is covered by focused unit tests where practical, or by documented manual verification if test harness is absent.

## 11. Rollout Plan

### Release Scope

V1 ships a single NYC-only applet with four tabs: For You, NYC Shows, Map, and Saved Venues. It uses Ticketmaster only, a 6-month horizon, and localStorage for saved venues unless Supabase persistence proves equally fast.

### Dependencies

- Ticketmaster Discovery API key.
- Vercel production and preview env var `TICKETMASTER_API_KEY` set to the Ticketmaster Consumer Key.
- Supabase service-role credentials already used by Next API routes.
- Existing `streaming_history` table.

### Risks

- Ticketmaster matching may be imperfect: Auto-pick exact/strong matches and silently skip weak matches in V1.
- Ticketmaster price data may be missing: Display "Price unavailable."
- Rate limits may be hit during artist fanout: Limit matching/search fanout and add short server-side cache.
- Discovery API daily quota may be exhausted: Cap personalized search to a small top-artist subset in MVP and cache responses.
- Venue map dependency could slow implementation: Use the simplest viable map/coordinate visualization first.

## 12. Testing Plan

### Automated Tests

- Add pure helper tests for price formatting, event normalization, venue extraction, duplicate event collapse, and top-artist SQL shape if a test harness is added.
- If no test runner exists yet, prioritize `npm run build` and browser/manual API verification for MVP.

### Manual Verification

1. Run `npm run build`.
2. Run `npm run dev`.
3. Open `http://localhost:3000/live-music`.
4. Verify For You loads or shows a useful empty/error state.
5. Verify NYC Shows loads upcoming events.
6. Verify Map toggles between liked-artist venues and all event venues.
7. Save a venue and verify it appears under Saved Venues.
8. Open a saved venue and verify upcoming shows render or an empty state appears.

## 13. Open Questions

- None blocking MVP. Broader metro support, richer venue persistence, and non-Ticketmaster sources are deferred.

## 14. Decision Log

| Date | Decision | Owner | Notes |
| --- | --- | --- | --- |
| 2026-06-10 | Use current calendar year to date for top artists. | Robbie | Ranked by total `ms_played`. |
| 2026-06-10 | Use Ticketmaster only for V1. | Robbie | Simpler and fastest. |
| 2026-06-10 | Scope to NYC, especially Manhattan, Brooklyn, and Queens. | Robbie | No multi-city support. |
| 2026-06-10 | Use a 6-month event horizon. | Robbie | Applies to all event searches. |
| 2026-06-10 | Show "Price unavailable" when Ticketmaster omits prices. | Robbie | Do not hide events. |
| 2026-06-10 | Use easiest persistence/map implementation for MVP. | Robbie | localStorage and simple map are acceptable. |
| 2026-06-10 | Use Ticketmaster Consumer Key as `TICKETMASTER_API_KEY`; do not use Consumer Secret for Discovery MVP. | Codex | Consumer Secret is only for future OAuth product work. |
