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
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((venue) => venue?.id && venue?.name)
      : [];
  } catch {
    return [];
  }
}

export function writeSavedVenues(venues: LiveMusicVenue[]) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(venues));
}

export function toggleSavedVenue(venue: LiveMusicVenue): LiveMusicVenue[] {
  const current = readSavedVenues();
  const exists = current.some((item) => item.id === venue.id);
  const next = exists
    ? current.filter((item) => item.id !== venue.id)
    : [...current, venue];
  writeSavedVenues(next);
  return next;
}
