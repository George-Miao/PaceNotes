import { createFileRoute } from "@tanstack/react-router";
import { StaticPage } from "~/components/StaticPage";

export const Route = createFileRoute("/terms")({ component: Terms });

function Terms() {
  return (
    <StaticPage title="Terms" intro="PaceNotes is open source software supplied without warranty.">
      <h2>Shared links</h2>
      <p>
        Anyone with a trip URL can view, edit, share, or delete that trip. Do not put private or
        regulated information in a trip.
      </p>
      <h2>External services</h2>
      <p>
        Google Maps Platform supplies map, place, photo, review, time-zone, and route content. Use
        is also subject to the Google Maps Platform Terms of Service and Google Privacy Policy.
      </p>
      <h2>No warranty</h2>
      <p>
        Routes, schedules, opening times, bookings, and place details can be wrong or out of date.
        Confirm critical travel information with the source.
      </p>
      <h2>Source</h2>
      <p>
        The application source is licensed under AGPL-3.0-or-later. Operators must provide the
        corresponding source for modified network deployments.
      </p>
    </StaticPage>
  );
}
