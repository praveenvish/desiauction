import { ButtonLink, Card, EmptyState, Stat, StatRow } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { platformAdminPageGate } from "../../../server/admin/authz";
import { newsletterSummary } from "../../../server/marketing/newsletter";
import { asPerson } from "../../../server/tenant";
import "../../seasons/seasons.css";
import "../admin.css";

export const metadata = { title: "Newsletter · Platform admin · DesiAuction" };

/**
 * THE PRODUCT-NEWS LIST, WITH AN OWNER.
 *
 * The footer collected addresses into a table nothing read. This is the reading:
 * how many, how recently, and an export for whoever sends the first update. The
 * export is its own access-log line, because it hands over every address at once.
 */
export default async function AdminNewsletterPage() {
  const admin = await platformAdminPageGate("newsletter");
  if (admin === null) {
    notFound();
  }
  const summary = await asPerson(admin.personId, (db) => newsletterSummary(db));
  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <header className="dash-head">
          <p className="competitions-hint">
            Addresses from the footer sign-up. Nothing sends to them yet. Each is deleted
            twenty-four months after it was added, and anyone can remove theirs at
            /newsletter/unsubscribe.
          </p>
        </header>
        {summary.total === 0 ? (
          <Card>
            <EmptyState
              headingLevel={2}
              title="Nobody has signed up"
              description="Addresses given in the site footer appear here."
            />
          </Card>
        ) : (
          <Card data-testid="newsletter-summary">
            <StatRow label="Newsletter">
              <Stat label="Addresses" value={String(summary.total)} />
              <Stat label="Added in the last 30 days" value={String(summary.lastThirtyDays)} />
            </StatRow>
            <p>
              <ButtonLink href="/admin/newsletter/export" variant="secondary">
                Download addresses (CSV)
              </ButtonLink>
            </p>
          </Card>
        )}
      </div>
    </main>
  );
}
