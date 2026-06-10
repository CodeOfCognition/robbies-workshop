# Live Music NYC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fast MVP applet that shows NYC concerts from Ticketmaster, personalized by the user's current-year top Spotify artists, with venue saving and a simple map view.

**Architecture:** Use a Next.js applet at `/live-music`. Server-side Next API routes query Supabase for top artists and call Ticketmaster Discovery API with a server-only API key. The client renders tabs and stores saved venues in localStorage for speed.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase JS, Ticketmaster Discovery API V2, CSS, optional Leaflet/OpenStreetMap only if installation time is acceptable.

---

## 1. Overview

### Feature Name

Live Music NYC

### Related Documents

- PRD: `features/live-music/01_PRD.md`
- Technical Requirements: `features/live-music/02_Tech_Requirements.md`

### Implementation Summary

Implement the MVP in thin vertical slices: shared types and Ticketmaster normalization first, API routes second, then the `/live-music` UI and launcher entry. Use localStorage for saved venues. Verify with `npm run build`, direct API route checks, and browser interaction at `localhost:3000/live-music`.

## 2. Assumptions

- `TICKETMASTER_API_KEY` will be available in `.env.local` and Vercel.
- `TICKETMASTER_API_KEY` is the Ticketmaster Consumer Key. `TICKETMASTER_CONSUMER_SECRET` may be stored server-side for future OAuth work but is not used by the Discovery API MVP.
- Ticketmaster public Discovery API allows 5000 requests per day and 5 requests per second; MVP fanout must stay capped and cached.
- Current-year top artists are based on `SUM(ms_played)` from `streaming_history`.
- NYC means Ticketmaster events in `New York`, `Brooklyn`, and `Queens`, NY.
- Saved venue persistence can be localStorage for MVP.
- Map view can be a simple coordinate plot if adding a map library slows the sprint.

## 3. Work Breakdown

### Phase 1: Data and Shared Logic

| Task | Owner | Status | Notes |
| --- | --- | --- | --- |
| Add shared live music types | Codex | Not Started | `src/lib/live-music/types.ts` |
| Add Ticketmaster client and normalizers | Codex | Not Started | `src/lib/live-music/ticketmaster.ts` |
| Add client saved venue helpers | Codex | Not Started | `src/lib/live-music/client-store.ts` |

### Phase 2: API Routes

| Task | Owner | Status | Notes |
| --- | --- | --- | --- |
| Add top artists API route | Codex | Not Started | Supabase SQL via server client |
| Add For You API route | Codex | Not Started | Top artists plus Ticketmaster artist search |
| Add NYC events API route | Codex | Not Started | Ticketmaster general NYC music search |
| Add venue events API route | Codex | Not Started | Ticketmaster `venueId` search |

### Phase 3: UI Rendering

| Task | Owner | Status | Notes |
| --- | --- | --- | --- |
| Add `/live-music` applet page | Codex | Not Started | Tabs, cards, saved venue actions |
| Add applet CSS | Codex | Not Started | Dense mobile-first interface |
| Add home page launcher card | Codex | Not Started | Link to `/live-music` |

### Phase 4: Verification

| Task | Owner | Status | Notes |
| --- | --- | --- | --- |
| Run build | Codex | Not Started | `npm run build` |
| Run local dev server | Codex | Not Started | `npm run dev` |
| Verify app in browser | Codex | Not Started | `/live-music` tabs and save venue |

## 4. Detailed Steps

### Task 1: Add Shared Types

**Files:**
- Create: `src/lib/live-music/types.ts`

- [ ] **Step 1: Create the directory**

Run:

```bash
mkdir -p src/lib/live-music
```

Expected: directory exists.

- [ ] **Step 2: Add normalized app types**

Create `src/lib/live-music/types.ts`:

```ts
export interface TopArtist {
  name: string;
  rank: number;
  msPlayed: number;
}

export interface LiveMusicVenue {
  id: string;
  name: string;
  city: string;
  stateCode: string;
  address?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface LiveMusicEvent {
  id: string;
  name: string;
  url?: string;
  dateLabel: string;
  sortDate: string;
  priceLabel: string;
  venue?: LiveMusicVenue;
  imageUrl?: string;
  matchedArtists: string[];
  reason?: string;
}

export interface LiveMusicPayload {
  generatedAt: string;
  events: LiveMusicEvent[];
  venues: LiveMusicVenue[];
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/live-music/types.ts
git commit -m "Add live music shared types"
```

### Task 2: Add Ticketmaster Server Client

**Files:**
- Create: `src/lib/live-music/ticketmaster.ts`

- [ ] **Step 1: Add Ticketmaster helpers**

Create `src/lib/live-music/ticketmaster.ts`:

```ts
import type { LiveMusicEvent, LiveMusicVenue } from "./types";

const ROOT = "https://app.ticketmaster.com/discovery/v2";
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { expiresAt: number; data: unknown }>();

export function getTicketmasterApiKey(): string {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) throw new Error("Ticketmaster is not configured");
  return key;
}

export function formatTicketmasterDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function eventWindow() {
  const start = new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + 6);
  return {
    startDateTime: formatTicketmasterDate(start),
    endDateTime: formatTicketmasterDate(end),
  };
}

export async function ticketmasterGet<T>(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const apiKey = getTicketmasterApiKey();
  const url = new URL(`${ROOT}${path}`);
  url.searchParams.set("apikey", apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data as T;

    const res = await fetch(cacheKey, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ticketmaster ${res.status}: ${text || res.statusText}`);
  }
  const data = (await res.json()) as T;
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
}

export function formatPriceRange(priceRanges: unknown): string {
  if (!Array.isArray(priceRanges) || priceRanges.length === 0) {
    return "Price unavailable";
  }
  const first = priceRanges[0] as { min?: number; max?: number; currency?: string };
  const currency = first.currency === "USD" || !first.currency ? "$" : `${first.currency} `;
  if (typeof first.min === "number" && typeof first.max === "number") {
    if (first.min === first.max) return `${currency}${Math.round(first.min)}`;
    return `${currency}${Math.round(first.min)}-${Math.round(first.max)}`;
  }
  if (typeof first.min === "number") return `From ${currency}${Math.round(first.min)}`;
  if (typeof first.max === "number") return `Up to ${currency}${Math.round(first.max)}`;
  return "Price unavailable";
}

export function normalizeVenue(raw: any): LiveMusicVenue | undefined {
  if (!raw?.id || !raw?.name) return undefined;
  const lat = raw.location?.latitude ? Number(raw.location.latitude) : undefined;
  const lng = raw.location?.longitude ? Number(raw.location.longitude) : undefined;
  return {
    id: raw.id,
    name: raw.name,
    city: raw.city?.name || "",
    stateCode: raw.state?.stateCode || raw.state?.name || "NY",
    address: raw.address?.line1,
    postalCode: raw.postalCode,
    latitude: Number.isFinite(lat) ? lat : undefined,
    longitude: Number.isFinite(lng) ? lng : undefined,
  };
}

export function normalizeEvent(raw: any, matchedArtist?: string): LiveMusicEvent | undefined {
  if (!raw?.id || !raw?.name) return undefined;
  const venue = normalizeVenue(raw._embedded?.venues?.[0]);
  const localDate = raw.dates?.start?.localDate || "";
  const localTime = raw.dates?.start?.localTime || "";
  const dateLabel = [localDate, localTime].filter(Boolean).join(" ");
  const imageUrl = Array.isArray(raw.images)
    ? raw.images.find((img: any) => img?.ratio === "16_9")?.url || raw.images[0]?.url
    : undefined;
  return {
    id: raw.id,
    name: raw.name,
    url: raw.url,
    dateLabel: dateLabel || "Date TBA",
    sortDate: raw.dates?.start?.dateTime || `${localDate}T${localTime || "00:00:00"}`,
    priceLabel: formatPriceRange(raw.priceRanges),
    venue,
    imageUrl,
    matchedArtists: matchedArtist ? [matchedArtist] : [],
    reason: matchedArtist ? `Because you listened to ${matchedArtist} this year.` : undefined,
  };
}

export function dedupeEvents(events: LiveMusicEvent[]): LiveMusicEvent[] {
  const byId = new Map<string, LiveMusicEvent>();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (!existing) {
      byId.set(event.id, event);
      continue;
    }
    const mergedArtists = Array.from(
      new Set([...existing.matchedArtists, ...event.matchedArtists])
    );
    byId.set(event.id, {
      ...existing,
      matchedArtists: mergedArtists,
      reason: mergedArtists.length
        ? `Because you listened to ${mergedArtists.join(", ")} this year.`
        : existing.reason,
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
}

export function uniqueVenues(events: LiveMusicEvent[]): LiveMusicVenue[] {
  const venues = new Map<string, LiveMusicVenue>();
  for (const event of events) {
    if (event.venue) venues.set(event.venue.id, event.venue);
  }
  return Array.from(venues.values()).sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/live-music/ticketmaster.ts
git commit -m "Add Ticketmaster live music client"
```

### Task 3: Add API Routes

**Files:**
- Create: `src/app/api/live-music/top-artists/route.ts`
- Create: `src/app/api/live-music/events/route.ts`
- Create: `src/app/api/live-music/for-you/route.ts`
- Create: `src/app/api/live-music/venues/[id]/events/route.ts`

- [ ] **Step 1: Add top artists route**

Create `src/app/api/live-music/top-artists/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import type { TopArtist } from "@/lib/live-music/types";

export async function GET() {
  try {
    const supabase = createServerSupabase();
    const year = new Date().getFullYear();
    const start = `${year}-01-01T00:00:00.000Z`;
    const { data, error } = await supabase
      .from("streaming_history")
      .select("artist_name, ms_played, ts")
      .gte("ts", start)
      .not("artist_name", "is", null)
      .limit(50000);
    if (error) throw error;

    const totals = new Map<string, number>();
    for (const row of data || []) {
      const name = String(row.artist_name || "").trim();
      if (!name) continue;
      totals.set(name, (totals.get(name) || 0) + Number(row.ms_played || 0));
    }
    const artists: TopArtist[] = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([name, msPlayed], index) => ({ name, msPlayed, rank: index + 1 }));
    return NextResponse.json({ year, artists });
  } catch (err) {
    console.error("[api/live-music/top-artists] failed:", err);
    return NextResponse.json({ error: "Failed to load top artists" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add general NYC events route**

Create `src/app/api/live-music/events/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  dedupeEvents,
  eventWindow,
  normalizeEvent,
  ticketmasterGet,
  uniqueVenues,
} from "@/lib/live-music/ticketmaster";

const NYC_CITIES = ["New York", "Brooklyn", "Queens"];

export async function GET() {
  try {
    const window = eventWindow();
    const batches = await Promise.all(
      NYC_CITIES.map((city) =>
        ticketmasterGet<any>("/events.json", {
          city,
          stateCode: "NY",
          countryCode: "US",
          classificationName: "music",
          sort: "date,asc",
          size: 50,
          ...window,
        })
      )
    );
    const events = dedupeEvents(
      batches.flatMap((body) =>
        (body._embedded?.events || [])
          .map((event: any) => normalizeEvent(event))
          .filter(Boolean)
      )
    );
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      events,
      venues: uniqueVenues(events),
    });
  } catch (err) {
    console.error("[api/live-music/events] failed:", err);
    return NextResponse.json({ error: "Failed to load NYC shows" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Add For You route**

Create `src/app/api/live-music/for-you/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import type { TopArtist } from "@/lib/live-music/types";
import {
  dedupeEvents,
  eventWindow,
  normalizeEvent,
  ticketmasterGet,
  uniqueVenues,
} from "@/lib/live-music/ticketmaster";

async function getTopArtists(): Promise<TopArtist[]> {
  const supabase = createServerSupabase();
  const year = new Date().getFullYear();
  const start = `${year}-01-01T00:00:00.000Z`;
  const { data, error } = await supabase
    .from("streaming_history")
    .select("artist_name, ms_played, ts")
    .gte("ts", start)
    .not("artist_name", "is", null)
    .limit(50000);
  if (error) throw error;

  const totals = new Map<string, number>();
  for (const row of data || []) {
    const name = String(row.artist_name || "").trim();
    if (!name) continue;
    totals.set(name, (totals.get(name) || 0) + Number(row.ms_played || 0));
  }
  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([name, msPlayed], index) => ({ name, msPlayed, rank: index + 1 }));
}

export async function GET() {
  try {
    const artists = await getTopArtists();
    const window = eventWindow();
    // Cap fanout to respect Ticketmaster's public Discovery API quota
    // (5000/day and 5 requests/second). This keeps the MVP responsive
    // while still covering the user's strongest listening signals.
    const searchArtists = artists.slice(0, 30);
    const batches = await Promise.allSettled(
      searchArtists.map((artist) =>
        ticketmasterGet<any>("/events.json", {
          keyword: artist.name,
          stateCode: "NY",
          countryCode: "US",
          classificationName: "music",
          sort: "date,asc",
          size: 10,
          ...window,
        }).then((body) => ({ artist, body }))
      )
    );
    const events = dedupeEvents(
      batches.flatMap((result) => {
        if (result.status !== "fulfilled") return [];
        return (result.value.body._embedded?.events || [])
          .map((event: any) => normalizeEvent(event, result.value.artist.name))
          .filter(Boolean);
      })
    );
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      artists,
      searchedArtists: searchArtists,
      events,
      venues: uniqueVenues(events),
    });
  } catch (err) {
    console.error("[api/live-music/for-you] failed:", err);
    return NextResponse.json({ error: "Failed to load personalized shows" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Add venue events route**

Create `src/app/api/live-music/venues/[id]/events/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  dedupeEvents,
  eventWindow,
  normalizeEvent,
  ticketmasterGet,
  uniqueVenues,
} from "@/lib/live-music/ticketmaster";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await ticketmasterGet<any>("/events.json", {
      venueId: id,
      classificationName: "music",
      sort: "date,asc",
      size: 50,
      ...eventWindow(),
    });
    const events = dedupeEvents(
      (body._embedded?.events || [])
        .map((event: any) => normalizeEvent(event))
        .filter(Boolean)
    );
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      events,
      venues: uniqueVenues(events),
    });
  } catch (err) {
    console.error("[api/live-music/venues/events] failed:", err);
    return NextResponse.json({ error: "Failed to load venue shows" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/live-music src/lib/live-music
git commit -m "Add live music API routes"
```

### Task 4: Add Client Store

**Files:**
- Create: `src/lib/live-music/client-store.ts`

- [ ] **Step 1: Add fetch and saved venue helpers**

Create `src/lib/live-music/client-store.ts`:

```ts
import type { LiveMusicPayload, LiveMusicVenue } from "./types";

const SAVED_KEY = "liveMusic.savedVenues";

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchForYou(): Promise<LiveMusicPayload> {
  return parseOrThrow(await fetch("/api/live-music/for-you", { cache: "no-store" }));
}

export async function fetchNycEvents(): Promise<LiveMusicPayload> {
  return parseOrThrow(await fetch("/api/live-music/events", { cache: "no-store" }));
}

export async function fetchVenueEvents(venueId: string): Promise<LiveMusicPayload> {
  return parseOrThrow(
    await fetch(`/api/live-music/venues/${encodeURIComponent(venueId)}/events`, {
      cache: "no-store",
    })
  );
}

export function readSavedVenues(): LiveMusicVenue[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((v) => v?.id && v?.name) : [];
  } catch {
    return [];
  }
}

export function writeSavedVenues(venues: LiveMusicVenue[]) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(venues));
}

export function toggleSavedVenue(venue: LiveMusicVenue): LiveMusicVenue[] {
  const current = readSavedVenues();
  const exists = current.some((v) => v.id === venue.id);
  const next = exists ? current.filter((v) => v.id !== venue.id) : [...current, venue];
  writeSavedVenues(next);
  return next;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/live-music/client-store.ts
git commit -m "Add live music client store"
```

### Task 5: Add Live Music Applet UI

**Files:**
- Create: `src/app/live-music/page.tsx`
- Create: `src/app/live-music/live-music.css`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add the applet page**

Create `src/app/live-music/page.tsx` with a client component that:

- Loads For You and NYC events on mount.
- Has tabs: `For You`, `NYC Shows`, `Map`, `Saved Venues`.
- Renders event cards with date, price, venue, reason, save venue button, Ticketmaster link.
- Renders map as a simple coordinate plot if no map library is installed.
- Reads and writes saved venues with `client-store.ts`.

Implementation note: keep this file MVP-focused; do not split components unless the file becomes hard to reason about.

- [ ] **Step 2: Add CSS**

Create `src/app/live-music/live-music.css` with:

- Full-height applet shell.
- Sticky compact header.
- Segmented tab controls.
- Dense event cards.
- Simple map plot container with venue pin buttons.
- Mobile-first responsive layout.

- [ ] **Step 3: Add launcher card**

Modify `src/app/page.tsx`:

- Import `Ticket` or `MapPin` from `lucide-react`.
- Add app card:

```ts
{
  name: "LIVE MUSIC NYC",
  description: "Upcoming shows and venues",
  href: "/live-music",
  icon: Ticket,
  color: "#f97373",
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/live-music src/app/page.tsx
git commit -m "Add live music applet UI"
```

### Task 6: Add Environment Documentation

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Document Ticketmaster env var**

Add to `.env.example`:

```bash
# Ticketmaster Discovery API
TICKETMASTER_API_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "Document Ticketmaster API key"
```

### Task 7: Verify Locally

**Files:**
- No code files unless verification finds a bug.

- [ ] **Step 1: Run build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 2: Start local server**

```bash
npm run dev
```

Expected: app serves at `http://localhost:3000`.

- [ ] **Step 3: Verify routes**

Open:

```text
http://localhost:3000/live-music
```

Expected:

- Applet shell renders.
- If `TICKETMASTER_API_KEY` is configured with the Ticketmaster Consumer Key, events load.
- If not configured, visible error says Ticketmaster is not configured.
- Tabs switch.
- Venue save/unsave changes Saved Venues.

- [ ] **Step 4: Commit fixes if needed**

```bash
git add <fixed files>
git commit -m "Fix live music MVP verification issues"
```

## 5. Test Plan

### Automated Checks

```bash
npm run build
```

Expected result:

- TypeScript and Next build pass.
- `/live-music` appears in the route list.

### Local App Verification

```bash
npm run dev
```

Expected result:

- Home page includes Live Music NYC.
- `/live-music` loads without auth.
- For You shows personalized events or a useful empty/error state.
- NYC Shows shows events or a useful empty/error state.
- Map view shows venue pins/list or an empty state.
- Saved Venues persists after page refresh.

## 6. Acceptance Criteria

- `/live-music` exists and is linked from the main app launcher.
- The app displays current-year top-artist-based Ticketmaster events for NYC over the next 6 months.
- The app displays general NYC music events over the next 6 months.
- Event cards show date, venue, price label, and Ticketmaster link.
- User can save and unsave venues.
- Saved venues display upcoming shows or a specific empty state.
- Ticketmaster API key is never referenced from client-side env.
- `npm run build` passes.

## 7. Rollback Plan

- Remove the Live Music NYC card from `src/app/page.tsx`.
- Delete `src/app/live-music`.
- Delete `src/app/api/live-music`.
- Delete `src/lib/live-music`.
- Remove `TICKETMASTER_API_KEY` from `.env.example`.

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Top-artist fanout is slow or rate-limited | For You loads slowly or errors | Search only top 30 artists in MVP and cache results for 10 minutes. |
| Ticketmaster quota is exhausted | Ticketmaster views fail for the day | Keep all calls server-side, cache for 10 minutes, and cap artist fanout. |
| Ticketmaster artist matching is noisy | Irrelevant events appear | Keep MVP, show matched artist reason, improve attraction matching later. |
| Price data missing | Cards look incomplete | Display "Price unavailable." |
| Map library slows build | MVP delayed | Use simple coordinate plot/list instead of a full map library. |

## 9. Dependencies

- Existing Supabase `streaming_history` table.
- Existing `createServerSupabase` helper.
- Ticketmaster Discovery API key.
- Vercel env var `TICKETMASTER_API_KEY` set to the Ticketmaster Consumer Key for Production and Preview.

## 10. Open Questions

- None blocking MVP.

## 11. Progress Log

| Date | Update | Owner | Notes |
| --- | --- | --- | --- |
| 2026-06-10 | PRD, technical requirements, and implementation plan created. | Codex | MVP scoped for fast build. |
