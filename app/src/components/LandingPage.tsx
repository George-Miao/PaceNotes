import { Icon } from "@iconify/react";
import arrowIcon from "@iconify-icons/lucide/arrow-right";
import copyIcon from "@iconify-icons/lucide/copy";
import githubIcon from "@iconify-icons/lucide/github";
import mapIcon from "@iconify-icons/lucide/map";
import routeIcon from "@iconify-icons/lucide/route";
import sparkIcon from "@iconify-icons/lucide/sparkles";
import trashIcon from "@iconify-icons/lucide/trash-2";
import usersIcon from "@iconify-icons/lucide/users";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { GooglePlaceSelection } from "~/features/google/google";
import { useTripTitle } from "~/features/google/use-trip-title";
import { createTrip, deleteTrip, getExistingTripIds } from "~/features/trip/trip.functions";
import { Brand } from "./Brand";
import { DestinationPicker } from "./DestinationPicker";

type RecentTrip = {
  id: string;
  title: string;
  destinationPlaceId?: string;
  href: string;
  openedAt: string;
};

export function LandingPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [startDate, setStartDate] = useState(today.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(
    new Date(today.getTime() + 4 * 86_400_000).toISOString().slice(0, 10),
  );
  const [destination, setDestination] = useState<GooglePlaceSelection | null>(null);
  const [recent, setRecent] = useState<RecentTrip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const stored = readRecent();
    let active = true;
    void getExistingTripIds({ data: { ids: stored.map((trip) => trip.id) } })
      .then(({ ids }) => {
        if (!active) return;
        const existingIds = new Set(ids);
        const next = stored.filter((trip) => existingIds.has(trip.id));
        if (next.length !== stored.length)
          localStorage.setItem("pacenotes-recent-trips", JSON.stringify(next));
        setRecent(next);
      })
      .catch(() => {
        if (active) setRecent(stored);
      });
    return () => {
      active = false;
    };
  }, []);
  const selectDestination = useCallback(
    (place: GooglePlaceSelection | null) => setDestination(place),
    [],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!destination) return;
    setCreating(true);
    setError(null);
    try {
      const { id } = await createTrip({
        data: {
          startDate,
          endDate,
          destination: destination.reference,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        },
      });
      await navigate({ to: "/trips/$tripId", params: { tripId: id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the trip");
      setCreating(false);
    }
  };
  const forget = (id: string) => {
    const next = (recent ?? []).filter((trip) => trip.id !== id);
    localStorage.setItem("pacenotes-recent-trips", JSON.stringify(next));
    setRecent(next);
  };
  const remove = async (trip: RecentTrip, displayTitle: string) => {
    if (!confirm(`Delete ${displayTitle} for everyone?`)) return;
    await deleteTrip({ data: { id: trip.id } });
    forget(trip.id);
  };

  return (
    <main className="landing">
      <header className="site-header">
        <Brand />
        <nav aria-label="Main navigation">
          <a
            className="icon-button"
            href="https://github.com/George-Miao/PaceNotes"
            rel="noreferrer"
            aria-label="GitHub repository"
          >
            <Icon icon={githubIcon} />
          </a>
        </nav>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Fast plans for real trips</span>
          <h1>
            Build the day.
            <br />
            <span>Keep the map moving.</span>
          </h1>
          <p>
            PaceNotes is an open source itinerary planner for people who edit together. Put places,
            reservations, stays, notes, and transport in one fast schedule.
          </p>
          <a className="text-link" href="https://github.com/George-Miao/PaceNotes" rel="noreferrer">
            View on GitHub <Icon icon={arrowIcon} />
          </a>
        </div>
        <div className="hero-create">
          <form id="create" className="create-card" onSubmit={submit}>
            <div className="section-heading">
              <h2>Create a trip</h2>
              <span>No account needed</span>
            </div>
            <div className="date-field-row">
              <label className="field">
                <span>Start date</span>
                <input
                  required
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    if (event.target.value > endDate) setEndDate(event.target.value);
                  }}
                />
              </label>
              <label className="field">
                <span>End date</span>
                <input
                  required
                  type="date"
                  min={startDate}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            </div>
            <DestinationPicker label="Where does the trip go?" onSelect={selectDestination} />
            {error ? <p className="field-error">{error}</p> : null}
            <button
              type="submit"
              className="primary-button large-button"
              disabled={creating || !destination}
            >
              {creating ? "Creating trip" : "Create trip"}
              <Icon icon={arrowIcon} />
            </button>
            <p className="form-note">
              Anyone with the random trip URL can view, edit, share, or delete the trip.
            </p>
          </form>
        </div>
      </section>

      <section id="features" className="feature-grid" aria-label="Features">
        <article>
          <Icon icon={mapIcon} />
          <h2>Map and list together</h2>
          <p>Select from the map or the itinerary. Numbered stops and route legs stay linked.</p>
        </article>
        <article>
          <Icon icon={usersIcon} />
          <h2>Edit together</h2>
          <p>Shared changes in real time.</p>
        </article>
        <article>
          <Icon icon={routeIcon} />
          <h2>Plan the whole day</h2>
          <p>Mix places, notes, bookings, stays, and transport in one ordered schedule.</p>
        </article>
        <article>
          <Icon icon={sparkIcon} />
          <h2>Stay fast at scale</h2>
          <p>Built for all your friends and families.</p>
        </article>
      </section>

      <section className="recent-section" aria-labelledby="recent-title">
        <div className="section-heading">
          <h2 id="recent-title">Recent trips</h2>
          <span>Stored in this browser</span>
        </div>
        {recent === null ? null : recent.length ? (
          <div className="recent-list">
            {recent.map((trip) => (
              <RecentTripCard key={trip.id} trip={trip} onForget={forget} onDelete={remove} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Icon icon={mapIcon} aria-hidden="true" />
            <strong>No recent trips.</strong>
            <p>Trips you open appear here. You can also open any shared trip URL directly.</p>
          </div>
        )}
      </section>

      <footer className="site-footer">
        <div>
          <strong>PaceNotes</strong>
          <span>Open source trip planning.</span>
        </div>
        <nav aria-label="Footer navigation">
          <a href="https://github.com/George-Miao/PaceNotes" rel="noreferrer">
            Source
          </a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/license">License</a>
        </nav>
      </footer>
    </main>
  );
}

function RecentTripCard({
  trip,
  onForget,
  onDelete,
}: {
  trip: RecentTrip;
  onForget: (id: string) => void;
  onDelete: (trip: RecentTrip, displayTitle: string) => Promise<void>;
}) {
  const title = useTripTitle(trip.title, trip.destinationPlaceId ?? "", "en");
  return (
    <article>
      <a href={trip.href}>
        <strong>{title}</strong>
        <span>
          Opened{" "}
          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
            new Date(trip.openedAt),
          )}
        </span>
      </a>
      <button
        type="button"
        className="icon-button"
        aria-label={`Copy ${title} link`}
        onClick={() => navigator.clipboard.writeText(trip.href)}
      >
        <Icon icon={copyIcon} />
      </button>
      <button type="button" className="ghost-button" onClick={() => onForget(trip.id)}>
        Forget
      </button>
      <button
        type="button"
        className="icon-button danger-icon"
        aria-label={`Delete ${title}`}
        onClick={() => onDelete(trip, title)}
      >
        <Icon icon={trashIcon} />
      </button>
    </article>
  );
}

function readRecent(): RecentTrip[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem("pacenotes-recent-trips") ?? "[]");
    return Array.isArray(stored) ? stored.filter(isRecentTrip) : [];
  } catch {
    return [];
  }
}

function isRecentTrip(value: unknown): value is RecentTrip {
  if (!value || typeof value !== "object") return false;
  const trip = value as Partial<RecentTrip>;
  return (
    typeof trip.id === "string" &&
    /^[A-Za-z0-9_-]{20,32}$/.test(trip.id) &&
    typeof trip.title === "string" &&
    typeof trip.href === "string" &&
    isTripHref(trip.href, trip.id) &&
    typeof trip.openedAt === "string" &&
    Number.isFinite(Date.parse(trip.openedAt)) &&
    (trip.destinationPlaceId === undefined || typeof trip.destinationPlaceId === "string")
  );
}

function isTripHref(href: string, id: string): boolean {
  try {
    const url = new URL(href, location.origin);
    return url.origin === location.origin && url.pathname === `/trips/${id}`;
  } catch {
    return false;
  }
}
