import { ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformModerationGate } from "../../../server/admin/authz";
import { MODERATION_FILTERS, adminModerationDesk } from "../../../server/admin/moderation-views";
import { AdminPageHead } from "../admin-ui";
import { ModerationPanel } from "./moderation-panel";
import "../../seasons/seasons.css";
import "../admin.css";
import "./moderation.css";

export const metadata = { title: "Moderation · Platform admin" };

/**
 * THE MODERATION DESK (0072) — taking a public season page down.
 *
 * Behind `platform:moderation`, a grant of its own: overriding an organizer's
 * decision to publish their own season is a different act of trust from seeing
 * the platform. Without it this page is a not-found, like every other desk.
 */
export default async function AdminModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; after?: string }>;
}) {
  const operator = await platformModerationGate();
  if (operator === null) {
    notFound();
  }
  await recordAdminAccess(operator, "moderation", null);
  const { q, filter, after } = await searchParams;
  const facet = MODERATION_FILTERS.find((key) => key === filter) ?? "all";
  const desk = await adminModerationDesk(typeof q === "string" ? q.slice(0, 100) : "", {
    filter: facet,
    ...(typeof after === "string" && after !== "" ? { after: after.slice(0, 26) } : {}),
  });
  if (desk === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack admin-stack">
          <AdminPageHead>
            Every season on the open web, and every one DesiAuction has taken down.
          </AdminPageHead>
          <ModerationPanel desk={desk} paged={typeof after === "string" && after !== ""} />
        </div>
      </main>
    </ToastProvider>
  );
}
