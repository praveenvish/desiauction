import {
  ButtonLink,
  IconCalendar,
  IconDownload,
  IconMail,
  SectionCard,
  StatCard,
  StatGrid,
} from "@desiauction/ui";
import { notFound } from "next/navigation";

import { platformAdminPageGate } from "../../../server/admin/authz";
import { newsletterSummary } from "../../../server/marketing/newsletter";
import { asPerson } from "../../../server/tenant";
import { AdminEmpty, AdminPageHead } from "../admin-ui";
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
      <div className="dash-stack admin-stack">
        <AdminPageHead readOnly>
          Footer sign-ups. Nothing sends yet; each address is deleted after 24 months.
        </AdminPageHead>
        {summary.total === 0 ? (
          <div className="admin-panel">
            <AdminEmpty icon={<IconMail size={24} weight="duotone" />} title="Nobody has signed up">
              Addresses given in the site footer appear here. Anyone can remove theirs at
              /newsletter/unsubscribe.
            </AdminEmpty>
          </div>
        ) : (
          <>
            <StatGrid testId="newsletter-summary">
              <StatCard
                icon={<IconMail />}
                tone="gold"
                value={String(summary.total)}
                label="Addresses"
                hint="On the product-news list"
              />
              <StatCard
                icon={<IconCalendar />}
                tone="green"
                value={String(summary.lastThirtyDays)}
                label="Added in the last 30 days"
              />
            </StatGrid>
            <SectionCard
              icon={<IconDownload />}
              tone="blue"
              title="Export"
              description="Every address at once, as CSV. The download is its own line in the access log."
              action={
                <ButtonLink href="/admin/newsletter/export" variant="secondary">
                  Download addresses (CSV)
                </ButtonLink>
              }
            />
          </>
        )}
      </div>
    </main>
  );
}
