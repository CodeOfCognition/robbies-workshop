import { NextResponse } from "next/server";
import { fetchNycMusicEvents, uniqueVenues } from "@/lib/live-music/ticketmaster";

export async function GET() {
  try {
    const events = await fetchNycMusicEvents(100);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      events,
      venues: uniqueVenues(events),
    });
  } catch (err) {
    console.error("[api/live-music/events] failed:", err);
    const message =
      err instanceof Error && err.message.includes("Ticketmaster is not configured")
        ? "Ticketmaster is not configured"
        : "Failed to load NYC shows";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
