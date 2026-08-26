import { Icon } from "@iconify/react";
import arrowIcon from "@iconify-icons/lucide/arrow-right";
import copyIcon from "@iconify-icons/lucide/copy";
import mapIcon from "@iconify-icons/lucide/map";
import routeIcon from "@iconify-icons/lucide/route";
import sparkIcon from "@iconify-icons/lucide/sparkles";
import trashIcon from "@iconify-icons/lucide/trash-2";
import usersIcon from "@iconify-icons/lucide/users";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { GooglePlaceSelection } from "~/features/google/google";
import { createTrip, deleteTrip } from "~/features/trip/trip.functions";
import { DestinationPicker } from "./DestinationPicker";

type RecentTrip = { id: string; title: string; href: string; openedAt: string };

export function LandingPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(today.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(
    new Date(today.getTime() + 4 * 86_400_000).toISOString().slice(0, 10),
  );
  const [destination, setDestination] = useState<GooglePlaceSelection | null>(null);
  const [recent, setRecent] = useState<RecentTrip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => setRecent(readRecent()), []);
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
          title,
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
    const next = recent.filter((trip) => trip.id !== id);
    localStorage.setItem("pacenotes-recent-trips", JSON.stringify(next));
    setRecent(next);
  };
  const remove = async (trip: RecentTrip) => {
    if (!confirm(`Delete ${trip.title} for everyone?`)) return;
    await deleteTrip({ data: { id: trip.id } });
    forget(trip.id);
  };

  return (
    <main className="landing">
      <header className="site-header">
        <a className="brand" href="/">
          PaceNotes
        </a>
        <nav aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="https://github.com/George-Miao/PaceNotes" rel="noreferrer">
            Source
          </a>
          <a href="/roadmap">Roadmap</a>
        </nav>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Fast plans for real trips</span>
          <h1>
            Build the day.
            <br />
            Keep the map moving.
          </h1>
          <p>
            PaceNotes is an open source itinerary planner for people who edit together. Put places,
            reservations, stays, notes, and transport in one fast schedule.
          </p>
          <a className="text-link" href="#create">
            Create a trip <Icon icon={arrowIcon} />
          </a>
        </div>
        <form id="create" className="create-card" onSubmit={submit}>
          <div className="section-heading">
            <h2>Create a trip</h2>
            <span>No account needed</span>
          </div>
          <label className="field">
            <span>Trip title</span>
            <input
              required
              maxLength={200}
              value={title}
              placeholder="Japan spring route"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
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
            disabled={creating || !destination || !title.trim()}
          >
            {creating ? "Creating trip" : "Create trip"}
            <Icon icon={arrowIcon} />
          </button>
          <p className="form-note">
            Anyone with the random trip URL can view, edit, share, or delete the trip.
          </p>
        </form>
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
          <p>Shared changes, presence, undo, and clear sync state without an account.</p>
        </article>
        <article>
          <Icon icon={routeIcon} />
          <h2>Plan the whole day</h2>
          <p>Mix places, notes, bookings, stays, and transport in one ordered schedule.</p>
        </article>
        <article>
          <Icon icon={sparkIcon} />
          <h2>Stay fast at scale</h2>
          <p>Built for 30 days, 500 places, and ten active editors on desktop or mobile.</p>
        </article>
      </section>

      <section className="product-preview" aria-labelledby="preview-title">
        <div>
          <span className="eyebrow">Map-first planning</span>
          <h2 id="preview-title">Enough detail to act. No dashboard noise.</h2>
          <p>
            Compact itinerary cards keep time, place type, route leg, and booking state visible.
            Rich Google place details load only when you expand an item.
          </p>
        </div>
        <div className="preview-window" aria-hidden="true">
          <div className="preview-list">
            <span>Thu 14</span>
            <strong>Nezu Shrine</strong>
            <small>09:00 - Bunkyo</small>
            <i />
            <strong>Shibuya Sky</strong>
            <small>12:30 - Confirmed</small>
          </div>
          <div className="preview-map">
            <b>1</b>
            <b>2</b>
            <b>3</b>
          </div>
        </div>
      </section>

      <section className="recent-section" aria-labelledby="recent-title">
        <div className="section-heading">
          <h2 id="recent-title">Recent trips</h2>
          <span>Stored in this browser</span>
        </div>
        {recent.length ? (
          <div className="recent-list">
            {recent.map((trip) => (
              <article key={trip.id}>
                <a href={trip.href}>
                  <strong>{trip.title}</strong>
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
                  aria-label={`Copy ${trip.title} link`}
                  onClick={() => navigator.clipboard.writeText(trip.href)}
                >
                  <Icon icon={copyIcon} />
                </button>
                <button type="button" className="ghost-button" onClick={() => forget(trip.id)}>
                  Forget
                </button>
                <button
                  type="button"
                  className="icon-button danger-icon"
                  aria-label={`Delete ${trip.title}`}
                  onClick={() => remove(trip)}
                >
                  <Icon icon={trashIcon} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-copy">
            Trips you open appear here. You can also open any shared trip URL directly.
          </p>
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
          <a href="/roadmap">Roadmap</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/license">License</a>
        </nav>
      </footer>
    </main>
  );
}

function readRecent(): RecentTrip[] {
  try {
    return JSON.parse(localStorage.getItem("pacenotes-recent-trips") ?? "[]");
  } catch {
    return [];
  }
}
