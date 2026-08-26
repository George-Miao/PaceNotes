import { createFileRoute } from "@tanstack/react-router";
import { StaticPage } from "~/components/StaticPage";

export const Route = createFileRoute("/license")({ component: License });

function License() {
  return (
    <StaticPage
      title="License"
      intro="PaceNotes is free software under the GNU Affero General Public License, version 3 or any later version."
    >
      <p>
        You may use, study, change, and share PaceNotes under the license terms. If you run a
        modified version as a network service, you must offer its corresponding source to the users
        of that service.
      </p>
      <p>
        <a href="/LICENSE">Read the full AGPL-3.0 license text</a>
      </p>
      <p>PaceNotes is supplied without warranty, to the extent permitted by law.</p>
    </StaticPage>
  );
}
