import { createFileRoute } from "@tanstack/react-router";
import { Planner } from "~/components/Planner";
import { getTripMetadata } from "~/features/trip/trip.functions";

export const Route = createFileRoute("/trips/$tripId")({
  loader: ({ params }) => getTripMetadata({ data: { id: params.tripId } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Trip"} - PaceNotes` },
      { name: "robots", content: "noindex,nofollow,noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  errorComponent: () => (
    <main className="not-found">
      <strong>Trip not found</strong>
      <span>The URL is wrong, or the trip was deleted.</span>
      <a href="/">Return to PaceNotes</a>
    </main>
  ),
  component: TripRoute,
});

function TripRoute() {
  const { tripId } = Route.useParams();
  return <Planner tripId={tripId} />;
}
