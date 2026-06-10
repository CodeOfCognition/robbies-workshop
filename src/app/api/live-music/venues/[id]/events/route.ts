import { NextResponse } from "next/server";
import {
  dedupeEvents,
  eventWindow,
  isUpcomingEvent,
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
        .filter(isUpcomingEvent)
    );
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      events,
      venues: uniqueVenues(events),
    });
  } catch (err) {
    console.error("[api/live-music/venues/events] failed:", err);
    const message =
      err instanceof Error && err.message.includes("Ticketmaster is not configured")
        ? "Ticketmaster is not configured"
        : "Failed to load venue shows";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
