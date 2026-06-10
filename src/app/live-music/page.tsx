"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ExternalLink,
  Heart,
  Loader2,
  MapPin,
  Music2,
  RefreshCw,
  Ticket,
} from "lucide-react";
import {
  fetchForYou,
  fetchNycEvents,
  fetchVenueEvents,
  readSavedVenues,
  toggleSavedVenue,
} from "@/lib/live-music/client-store";
import type { LiveMusicEvent, LiveMusicPayload, LiveMusicVenue } from "@/lib/live-music/types";
import "./live-music.css";

type Tab = "for-you" | "nyc" | "map" | "saved";
type MapMode = "liked" | "all";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "for-you", label: "For You" },
  { id: "nyc", label: "NYC Shows" },
  { id: "map", label: "Map" },
  { id: "saved", label: "Saved" },
];

const EMPTY_PAYLOAD: LiveMusicPayload = {
  generatedAt: "",
  events: [],
  venues: [],
};

export default function LiveMusicPage() {
  const [tab, setTab] = useState<Tab>("for-you");
  const [mapMode, setMapMode] = useState<MapMode>("liked");
  const [forYou, setForYou] = useState<LiveMusicPayload>(EMPTY_PAYLOAD);
  const [nyc, setNyc] = useState<LiveMusicPayload>(EMPTY_PAYLOAD);
  const [savedVenues, setSavedVenues] = useState<LiveMusicVenue[]>([]);
  const [venueShows, setVenueShows] = useState<Record<string, LiveMusicPayload>>({});
  const [loading, setLoading] = useState(true);
  const [savedLoading, setSavedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [forYouPayload, nycPayload] = await Promise.all([
        fetchForYou(),
        fetchNycEvents(),
      ]);
      setForYou(forYouPayload);
      setNyc(nycPayload);
    } catch (err) {
      console.error("[live-music] load failed:", err);
      setError(err instanceof Error ? err.message : "Failed to load shows");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSavedVenues(readSavedVenues());
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== "saved" || savedVenues.length === 0) return;
    let cancelled = false;
    setSavedLoading(true);
    (async () => {
      const entries = await Promise.all(
        savedVenues.map(async (venue) => {
          if (venueShows[venue.id]) return [venue.id, venueShows[venue.id]] as const;
          try {
            return [venue.id, await fetchVenueEvents(venue.id)] as const;
          } catch (err) {
            console.error("[live-music] saved venue fetch failed:", venue.name, err);
            return [
              venue.id,
              {
                generatedAt: new Date().toISOString(),
                events: [],
                venues: [],
              },
            ] as const;
          }
        })
      );
      if (!cancelled) {
        setVenueShows((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
        setSavedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [savedVenues, tab, venueShows]);

  const savedIds = useMemo(
    () => new Set(savedVenues.map((venue) => venue.id)),
    [savedVenues]
  );

  const handleToggleVenue = useCallback((venue?: LiveMusicVenue) => {
    if (!venue) return;
    setSavedVenues(toggleSavedVenue(venue));
  }, []);

  const mapVenues = mapMode === "liked" ? forYou.venues : nyc.venues;

  return (
    <div className="lm-shell">
      <header className="lm-header">
        <Link href="/" className="lm-back" aria-label="Back to workshop">
          <ChevronLeft className="h-5 w-5" />
          <span>Back</span>
        </Link>
        <div className="lm-title-wrap">
          <div className="lm-kicker">
            <Ticket className="h-4 w-4" />
            New York City
          </div>
          <h1>Live Music NYC</h1>
        </div>
        <button className="lm-icon-btn" onClick={load} disabled={loading} aria-label="Refresh shows">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </header>

      <nav className="lm-tabs" aria-label="Live music views">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="lm-error">
          <strong>Couldn&apos;t load live music.</strong>
          <span>{error}</span>
        </div>
      )}

      {loading && !error ? (
        <LoadingState />
      ) : (
        <main className="lm-main">
          {tab === "for-you" && (
            <EventList
              title="Shows by artists you like"
              subtitle="Searching your top 50 Spotify artists this year for NYC shows in the next 6 months."
              events={forYou.events}
              savedIds={savedIds}
              onToggleVenue={handleToggleVenue}
              emptyTitle="No matched shows yet"
              emptyBody="Ticketmaster did not return upcoming NYC shows for your strongest current-year artists."
            />
          )}

          {tab === "nyc" && (
            <EventList
              title="Upcoming NYC shows"
              subtitle="Ticketmaster music events in Manhattan, Brooklyn, and Queens."
              events={nyc.events}
              savedIds={savedIds}
              onToggleVenue={handleToggleVenue}
              emptyTitle="No NYC shows found"
              emptyBody="Ticketmaster did not return upcoming music events for the current search."
            />
          )}

          {tab === "map" && (
            <section className="lm-section">
              <SectionHeader
                title="Venue map"
                subtitle="A quick plot of venues with upcoming shows."
              />
              <div className="lm-map-toggle">
                <button
                  className={mapMode === "liked" ? "active" : ""}
                  onClick={() => setMapMode("liked")}
                >
                  Liked artists
                </button>
                <button
                  className={mapMode === "all" ? "active" : ""}
                  onClick={() => setMapMode("all")}
                >
                  All venues
                </button>
              </div>
              <VenueMap
                venues={mapVenues}
                savedIds={savedIds}
                onToggleVenue={handleToggleVenue}
              />
            </section>
          )}

          {tab === "saved" && (
            <section className="lm-section">
              <SectionHeader
                title="Saved venues"
                subtitle="Places you want to keep an eye on."
              />
              {savedVenues.length === 0 ? (
                <EmptyState
                  title="No saved venues"
                  body="Save a venue from any event card or map pin."
                />
              ) : (
                <div className="lm-saved-list">
                  {savedLoading && (
                    <div className="lm-subtle-loading">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading venue calendars
                    </div>
                  )}
                  {savedVenues.map((venue) => (
                    <SavedVenueBlock
                      key={venue.id}
                      venue={venue}
                      payload={venueShows[venue.id]}
                      onRemove={() => handleToggleVenue(venue)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="lm-loading">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span>Finding shows</span>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="lm-section-header">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function EventList({
  title,
  subtitle,
  events,
  savedIds,
  onToggleVenue,
  emptyTitle,
  emptyBody,
}: {
  title: string;
  subtitle: string;
  events: LiveMusicEvent[];
  savedIds: Set<string>;
  onToggleVenue: (venue?: LiveMusicVenue) => void;
  emptyTitle: string;
  emptyBody: string;
}) {
  return (
    <section className="lm-section">
      <SectionHeader title={title} subtitle={subtitle} />
      {events.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <div className="lm-event-list">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              saved={!!event.venue && savedIds.has(event.venue.id)}
              onToggleVenue={onToggleVenue}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EventCard({
  event,
  saved,
  onToggleVenue,
}: {
  event: LiveMusicEvent;
  saved: boolean;
  onToggleVenue: (venue?: LiveMusicVenue) => void;
}) {
  return (
    <article className="lm-card lm-event-card">
      {event.imageUrl && (
        <div
          className="lm-event-image"
          style={{ backgroundImage: `url(${event.imageUrl})` }}
          aria-hidden="true"
        />
      )}
      <div className="lm-event-body">
        <div className="lm-event-topline">
          <span>
            <CalendarDays className="h-3.5 w-3.5" />
            {event.dateLabel}
            {event.timeLabel ? ` · ${event.timeLabel}` : ""}
          </span>
          <span>{event.priceLabel}</span>
        </div>
        <h3>{event.name}</h3>
        {event.venue && (
          <div className="lm-venue-line">
            <MapPin className="h-4 w-4" />
            <span>
              {event.venue.name}
              {event.venue.city ? ` · ${event.venue.city}` : ""}
            </span>
          </div>
        )}
        {event.reason && <p className="lm-reason">{event.reason}</p>}
        <div className="lm-card-actions">
          {event.venue && (
            <button
              className={saved ? "lm-save saved" : "lm-save"}
              onClick={() => onToggleVenue(event.venue)}
            >
              <Heart className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
              {saved ? "Saved" : "Save venue"}
            </button>
          )}
          {event.url && (
            <a href={event.url} target="_blank" rel="noreferrer" className="lm-linkout">
              Tickets
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function VenueMap({
  venues,
  savedIds,
  onToggleVenue,
}: {
  venues: LiveMusicVenue[];
  savedIds: Set<string>;
  onToggleVenue: (venue: LiveMusicVenue) => void;
}) {
  const plotted = venues.filter(
    (venue) => typeof venue.latitude === "number" && typeof venue.longitude === "number"
  );
  const bounds = plotted.reduce(
    (acc, venue) => ({
      minLat: Math.min(acc.minLat, venue.latitude!),
      maxLat: Math.max(acc.maxLat, venue.latitude!),
      minLng: Math.min(acc.minLng, venue.longitude!),
      maxLng: Math.max(acc.maxLng, venue.longitude!),
    }),
    { minLat: 40.55, maxLat: 40.9, minLng: -74.05, maxLng: -73.75 }
  );

  const lngSpan = Math.max(0.01, bounds.maxLng - bounds.minLng);
  const latSpan = Math.max(0.01, bounds.maxLat - bounds.minLat);

  if (venues.length === 0) {
    return <EmptyState title="No venues to map" body="Load shows first, then venues will appear here." />;
  }

  return (
    <>
      <div className="lm-map" role="img" aria-label="Venue locations in New York City">
        <div className="lm-map-grid" />
        {plotted.map((venue) => {
          const left = ((venue.longitude! - bounds.minLng) / lngSpan) * 100;
          const top = (1 - (venue.latitude! - bounds.minLat) / latSpan) * 100;
          const saved = savedIds.has(venue.id);
          return (
            <button
              key={venue.id}
              className={saved ? "lm-pin saved" : "lm-pin"}
              style={{ left: `${left}%`, top: `${top}%` }}
              onClick={() => onToggleVenue(venue)}
              title={saved ? `Remove ${venue.name}` : `Save ${venue.name}`}
            >
              <MapPin className="h-4 w-4" fill={saved ? "currentColor" : "none"} />
            </button>
          );
        })}
      </div>
      <div className="lm-venue-grid">
        {venues.map((venue) => (
          <button
            key={venue.id}
            className={savedIds.has(venue.id) ? "lm-venue-chip saved" : "lm-venue-chip"}
            onClick={() => onToggleVenue(venue)}
          >
            <Music2 className="h-4 w-4" />
            <span>{venue.name}</span>
            <small>{venue.city || "NYC"}</small>
          </button>
        ))}
      </div>
    </>
  );
}

function SavedVenueBlock({
  venue,
  payload,
  onRemove,
}: {
  venue: LiveMusicVenue;
  payload?: LiveMusicPayload;
  onRemove: () => void;
}) {
  return (
    <article className="lm-card lm-saved-venue">
      <div className="lm-saved-head">
        <div>
          <h3>{venue.name}</h3>
          <p>{[venue.address, venue.city].filter(Boolean).join(" · ") || "NYC"}</p>
        </div>
        <button className="lm-save saved" onClick={onRemove}>
          <Heart className="h-4 w-4" fill="currentColor" />
          Saved
        </button>
      </div>
      {!payload ? (
        <div className="lm-subtle-loading">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading shows
        </div>
      ) : payload.events.length === 0 ? (
        <p className="lm-empty-inline">No upcoming Ticketmaster shows found for this venue.</p>
      ) : (
        <div className="lm-mini-events">
          {payload.events.slice(0, 6).map((event) => (
            <div key={event.id} className="lm-mini-event">
              <span>{event.dateLabel}</span>
              {event.url ? (
                <a href={event.url} target="_blank" rel="noreferrer">
                  {event.name}
                </a>
              ) : (
                <strong>{event.name}</strong>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="lm-empty">
      <Music2 className="h-6 w-6" />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
