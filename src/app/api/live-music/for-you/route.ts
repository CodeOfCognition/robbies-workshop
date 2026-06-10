import { NextResponse } from "next/server";
import { getCurrentYearTopArtists } from "@/lib/live-music/top-artists";
import type { LiveMusicEvent, TopArtist } from "@/lib/live-music/types";
import {
  dedupeEvents,
  eventWindow,
  eventMatchesArtist,
  fetchNycMusicEvents,
  isUpcomingEvent,
  matchTopArtist,
  normalizeEvent,
  ticketmasterGet,
  uniqueVenues,
} from "@/lib/live-music/ticketmaster";

const SEARCH_ARTIST_LIMIT = 50;
const NYC_CITY_SET = new Set(["new york", "brooklyn", "queens"]);
const RESPONSE_CACHE_TTL_MS = 10 * 60 * 1000;
let responseCache: { expiresAt: number; data: unknown } | null = null;

function isNycEvent(event: LiveMusicEvent): boolean {
  const city = event.venue?.city?.toLocaleLowerCase();
  return !!city && NYC_CITY_SET.has(city);
}

async function searchArtistEvents(artist: TopArtist): Promise<LiveMusicEvent[]> {
  const body = await ticketmasterGet<any>("/events.json", {
    keyword: artist.name,
    stateCode: "NY",
    countryCode: "US",
    classificationName: "music",
    sort: "date,asc",
    size: 10,
    ...eventWindow(),
  });

  return (body._embedded?.events || [])
    .map((event: any) => normalizeEvent(event, artist.name))
    .filter(Boolean)
    .filter(isUpcomingEvent)
    .filter(isNycEvent)
    .filter((event: LiveMusicEvent) => eventMatchesArtist(event, artist.name));
}

export async function GET() {
  try {
    if (responseCache && responseCache.expiresAt > Date.now()) {
      return NextResponse.json(responseCache.data);
    }

    const artists = await getCurrentYearTopArtists(100);
    const artistNames = artists.map((artist) => artist.name);
    const baseEvents = await fetchNycMusicEvents(100);
    const personalizedFromNyc = baseEvents
      .map((event) => {
        const match = matchTopArtist(event, artistNames);
        return match
          ? {
              ...event,
              matchedArtists: [match],
              reason: `Because you listened to ${match} this year.`,
            }
          : undefined;
      })
      .filter(Boolean) as LiveMusicEvent[];

    const searchedArtists = artists.slice(0, SEARCH_ARTIST_LIMIT);
    const searchedEvents: LiveMusicEvent[] = [];
    const results = await Promise.allSettled(
      searchedArtists.map((artist) => searchArtistEvents(artist))
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        searchedEvents.push(...result.value);
      } else {
        console.warn(
          "[api/live-music/for-you] artist search failed:",
          searchedArtists[index]?.name,
          result.reason
        );
      }
    });

    const events = dedupeEvents([...personalizedFromNyc, ...searchedEvents]);
    const payload = {
      generatedAt: new Date().toISOString(),
      artists,
      searchedArtists,
      events,
      venues: uniqueVenues(events),
    };
    responseCache = { expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS, data: payload };
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/live-music/for-you] failed:", err);
    const message =
      err instanceof Error && err.message.includes("Ticketmaster is not configured")
        ? "Ticketmaster is not configured"
        : "Failed to load personalized shows";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
