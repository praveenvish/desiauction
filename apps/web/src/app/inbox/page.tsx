import { competitions } from "@desiauction/db";
import { Card, EmptyState } from "@desiauction/ui";
import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

import { detailOf } from "../../lib/inbox-events";
import { currentSession } from "../../server/auth/actions";
import { systemDb } from "../../server/db";
import { listSecurityEvents } from "../../server/auth/security-events";
import { InboxList } from "./inbox-list";
import "./inbox.css";

export const metadata = { title: "Notifications · DesiAuction" };

/** How many notices load. The old hard 10 could not show last week's decision. */
const WINDOW = 50;

/**
 * The competitions named by this person's own notices, resolved to a name and
 * a slug.
 *
 * `notifyPlayer` writes `{ competitionId }` into each registration notice's
 * meta — and the inbox threw the whole meta column away, so "your registration
 * was approved" could not say WHICH tournament, and nothing on the page was
 * clickable (measured: 0 links, 0 buttons). The ids come from rows already
 * proven to belong to this person by the person-scoped ledger read above, so
 * this is the documented cross-org, person-scoped system-pool class — the same
 * one `myRegistrations` uses.
 *
 * A link is offered only for a PUBLISHED competition: a private one has no page
 * this person can open, and a link that 404s is worse than a name.
 */
async function competitionsNamed(
  ids: readonly string[],
): Promise<Map<string, { name: string; slug: string; publicPage: boolean }>> {
  const unique = [...new Set(ids)].filter((id) => id !== "");
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await systemDb
    .select({
      id: competitions.id,
      name: competitions.name,
      slug: competitions.slug,
      visibility: competitions.visibility,
    })
    .from(competitions)
    .where(inArray(competitions.id, unique));
  return new Map(
    rows.map((row) => [
      row.id,
      { name: row.name, slug: row.slug, publicPage: row.visibility === "public" },
    ]),
  );
}

function competitionIdOf(meta: unknown): string | null {
  // `in` narrows without a cast: an `as Record<string, unknown>` reads as a
  // no-op to eslint, and `Reflect.get` hands back `any`.
  if (typeof meta !== "object" || meta === null || !("competitionId" in meta)) {
    return null;
  }
  const value: unknown = meta.competitionId;
  return typeof value === "string" && value !== "" ? value : null;
}

// PX-3: notifications over EXISTING events (the person-scoped security ledger).
// No notification storage was invented: rows come from audit_log via
// listSecurityEvents; read-state is device-local (same contract as pins), now
// keyed per account so it cannot cross people on a shared handset.
export default async function InboxPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/inbox");
  }
  const events = await listSecurityEvents(session.personId, WINDOW);
  const named = await competitionsNamed(
    events.map((event) => competitionIdOf(event.meta) ?? "").filter((id) => id !== ""),
  );
  return (
    <main>
      <Card>
        {events.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="Nothing yet"
            description="Registration decisions and account activity land here."
          />
        ) : (
          <InboxList
            personId={session.personId}
            events={events.map((event) => {
              const competitionId = competitionIdOf(event.meta);
              const competition = competitionId === null ? undefined : named.get(competitionId);
              const detail = detailOf(event.meta);
              return {
                action: event.action,
                at: event.at.toISOString(),
                ...(detail === null ? {} : { detail }),
                ...(competition !== undefined
                  ? {
                      subject: {
                        name: competition.name,
                        ...(competition.publicPage ? { href: `/c/${competition.slug}` } : {}),
                      },
                    }
                  : {}),
              };
            })}
          />
        )}
      </Card>
    </main>
  );
}
