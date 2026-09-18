import { Card, ToastProvider } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { recordAdminAccess } from "../../../server/admin/access-log";
import { platformModerationGate } from "../../../server/admin/authz";
import { adminModerationDesk } from "../../../server/admin/moderation-views";
import { ModerationPanel } from "./moderation-panel";
import "../../seasons/seasons.css";
import "../admin.css";

export const metadata = { title: "Moderation · Platform admin · DesiAuction" };

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
  searchParams: Promise<{ q?: string }>;
}) {
  const operator = await platformModerationGate();
  if (operator === null) {
    notFound();
  }
  await recordAdminAccess(operator, "moderation", null);
  const { q } = await searchParams;
  const desk = await adminModerationDesk(typeof q === "string" ? q.slice(0, 100) : "");
  if (desk === null) {
    notFound();
  }
  return (
    <ToastProvider>
      <main className="registrations-dash">
        <div className="dash-stack">
          <header className="dash-head">
            <p className="competitions-hint">
              Every season on the open web, and every one DesiAuction has taken down. Taking a page
              down removes its public page, player pages, share cards and directory listing at once;
              the club keeps running its season. The organizer sees your reason, and it lands on the
              audit log against your name.
            </p>
          </header>
          <Card>
            <form
              className="admin-filters"
              method="get"
              role="search"
              data-testid="moderation-search"
            >
              <div className="admin-filter-grow">
                <label className="stat-label" htmlFor="moderation-q">
                  Find a public season
                </label>
                <input
                  id="moderation-q"
                  name="q"
                  type="search"
                  defaultValue={desk.query}
                  placeholder="Season, slug or club"
                  className="admin-search-input"
                />
              </div>
              <button type="submit" className="admin-search-submit">
                Search
              </button>
            </form>
          </Card>
          <ModerationPanel desk={desk} />
        </div>
      </main>
    </ToastProvider>
  );
}
