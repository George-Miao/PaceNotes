import { createFileRoute } from "@tanstack/react-router";
import { Planner } from "~/components/Planner";
import { requireTripMetadata, TripLoadError, TripNotFound } from "~/features/trip/route-state";
import { getTripMetadata } from "~/features/trip/trip.functions";

export const Route = createFileRoute("/trips/$tripId")({
  loader: ({ params }) =>
    requireTripMetadata(() => getTripMetadata({ data: { id: params.tripId } })),
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title || "Trip"} - PaceNotes` },
      { name: "robots", content: "noindex,nofollow,noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  notFoundComponent: TripNotFound,
  errorComponent: TripLoadError,
  component: TripRoute,
});

function TripRoute() {
  const { tripId } = Route.useParams();
  return <Planner tripId={tripId} />;
}
