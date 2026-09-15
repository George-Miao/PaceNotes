import { notFound } from "@tanstack/react-router";

export async function requireTripMetadata<T>(load: () => Promise<T | null>): Promise<T> {
  const metadata = await load();
  if (metadata === null) throw notFound();
  return metadata;
}

export function TripNotFound() {
  return (
    <main className="not-found">
      <strong>Trip not found</strong>
      <span>The URL is wrong, or the trip was deleted.</span>
      <a href="/">Return to PaceNotes</a>
    </main>
  );
}

export function TripLoadError() {
  return (
    <main className="not-found">
      <strong>Trip could not be loaded</strong>
      <span>Something went wrong. Try again.</span>
      <button type="button" className="text-button" onClick={() => window.location.reload()}>
        Try again
      </button>
    </main>
  );
}
