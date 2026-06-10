import type { LiveMusicEvent, LiveMusicVenue } from "./types";

const ROOT = "https://app.ticketmaster.com/discovery/v2";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_SPACING_MS = 275;
const cache = new Map<string, { expiresAt: number; data: unknown }>();
let nextRequestAt = 0;

export const NYC_CITIES = ["New York", "Brooklyn", "Queens"] as const;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTicketmasterSlot() {
  const now = Date.now();
  const waitMs = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + REQUEST_SPACING_MS;
  if (waitMs > 0) await sleep(waitMs);
}

export async function ticketmasterGet<T>(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${ROOT}${path}`);
  url.searchParams.set("apikey", getTicketmasterApiKey());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data as T;

  await waitForTicketmasterSlot();
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
  const first = priceRanges[0] as {
    min?: number;
    max?: number;
    currency?: string;
  };
  const currency = first.currency === "USD" || !first.currency ? "$" : `${first.currency} `;
  if (typeof first.min === "number" && typeof first.max === "number") {
    if (Math.round(first.min) === Math.round(first.max)) {
      return `${currency}${Math.round(first.min)}`;
    }
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

function formatDateLabel(localDate?: string): string {
  if (!localDate) return "Date TBA";
  const date = new Date(`${localDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return localDate;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeLabel(localTime?: string): string | undefined {
  if (!localTime) return undefined;
  const date = new Date(`2000-01-01T${localTime}`);
  if (Number.isNaN(date.getTime())) return localTime;
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function normalizeEvent(
  raw: any,
  matchedArtist?: string
): LiveMusicEvent | undefined {
  if (!raw?.id || !raw?.name) return undefined;
  const venue = normalizeVenue(raw._embedded?.venues?.[0]);
  const attractions = Array.isArray(raw._embedded?.attractions)
    ? raw._embedded.attractions.map((a: any) => String(a?.name || "")).filter(Boolean)
    : [];
  const localDate = raw.dates?.start?.localDate || "";
  const localTime = raw.dates?.start?.localTime || "";
  const imageUrl = Array.isArray(raw.images)
    ? raw.images.find((img: any) => img?.ratio === "16_9")?.url || raw.images[0]?.url
    : undefined;

  return {
    id: raw.id,
    name: raw.name,
    url: raw.url,
    dateLabel: formatDateLabel(localDate),
    timeLabel: formatTimeLabel(localTime),
    sortDate: raw.dates?.start?.dateTime || `${localDate}T${localTime || "00:00:00"}`,
    priceLabel: formatPriceRange(raw.priceRanges),
    venue,
    imageUrl,
    attractionNames: attractions,
    matchedArtists: matchedArtist ? [matchedArtist] : [],
    reason: matchedArtist ? `Because you listened to ${matchedArtist} this year.` : undefined,
  };
}

export function isUpcomingEvent(event: LiveMusicEvent): boolean {
  const date = new Date(event.sortDate);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() >= Date.now() - 60 * 60 * 1000;
}

export function dedupeEvents(events: LiveMusicEvent[]): LiveMusicEvent[] {
  const byId = new Map<string, LiveMusicEvent>();
  for (const event of events) {
    const existing = byId.get(event.id);
    if (!existing) {
      byId.set(event.id, event);
      continue;
    }
    const matchedArtists = Array.from(
      new Set([...existing.matchedArtists, ...event.matchedArtists])
    );
    byId.set(event.id, {
      ...existing,
      matchedArtists,
      reason: matchedArtists.length
        ? `Because you listened to ${matchedArtists.join(", ")} this year.`
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

function normalizeForMatch(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(haystack);
}

export function eventMatchesArtist(event: LiveMusicEvent, artistName: string): boolean {
  const artist = normalizeForMatch(artistName);
  if (!artist) return false;

  const attractionMatch = event.attractionNames.some((attraction) => {
    const normalized = normalizeForMatch(attraction);
    return normalized === artist || containsPhrase(normalized, artist);
  });
  if (attractionMatch) return true;

  const eventName = normalizeForMatch(event.name);
  return containsPhrase(eventName, artist);
}

export async function fetchNycMusicEvents(size = 100): Promise<LiveMusicEvent[]> {
  const window = eventWindow();
  const batches = await Promise.all(
    NYC_CITIES.map((city) =>
      ticketmasterGet<any>("/events.json", {
        city,
        stateCode: "NY",
        countryCode: "US",
        classificationName: "music",
        sort: "date,asc",
        size,
        ...window,
      })
    )
  );
  return dedupeEvents(
    batches.flatMap((body) =>
      (body._embedded?.events || [])
        .map((event: any) => normalizeEvent(event))
        .filter(Boolean)
        .filter(isUpcomingEvent)
    )
  );
}

export function matchTopArtist(event: LiveMusicEvent, artistNames: string[]): string | undefined {
  return artistNames.find((artist) => eventMatchesArtist(event, artist));
}
