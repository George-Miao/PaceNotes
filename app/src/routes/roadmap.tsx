import { createFileRoute } from "@tanstack/react-router";
import { StaticPage } from "~/components/StaticPage";

export const Route = createFileRoute("/roadmap")({ component: Roadmap });

function Roadmap() {
  return (
    <StaticPage
      title="Roadmap"
      intro="The MVP keeps one fast shared itinerary at the center. These items are planned after that contract is stable."
    >
      <h2>Next</h2>
      <ul>
        <li>Authentication, named accounts, roles, and controlled trip access.</li>
        <li>Secret-link rotation and stronger sharing controls.</li>
        <li>Operator-selectable place and route providers.</li>
        <li>Additional open review and description sources.</li>
      </ul>
      <h2>Later</h2>
      <ul>
        <li>Offline trip editing and conflict recovery after long disconnections.</li>
        <li>Imports, exports, attachments, budgets, and booking inbox integration.</li>
        <li>Native mobile applications.</li>
      </ul>
    </StaticPage>
  );
}
