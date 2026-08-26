import { createFileRoute } from "@tanstack/react-router";
import { StaticPage } from "~/components/StaticPage";

export const Route = createFileRoute("/privacy")({ component: Privacy });

function Privacy() {
  return (
    <StaticPage
      title="Privacy"
      intro="PaceNotes has no user accounts. A random trip URL gives full edit access."
    >
      <h2>Trip data</h2>
      <p>
        The server stores trip content, live collaboration data, Google place identity snapshots,
        and route settings. Editors can permanently delete a trip. A browser that already received
        data can keep its own copy.
      </p>
      <h2>Browser data</h2>
      <p>
        This browser stores recent trip links, the local display name, share-warning state, and
        application shell files. PaceNotes does not promise offline access to trip data.
      </p>
      <h2>Google Maps Platform</h2>
      <p>
        Place search, maps, place details, photos, reviews, time zones, and routes send requests to
        Google. The operator must publish its own Google privacy notices and configure restricted
        keys.
      </p>
      <h2>Logs</h2>
      <p>
        Production logs must not contain trip URLs, Google query text, notes, or provider request
        parameters.
      </p>
    </StaticPage>
  );
}
