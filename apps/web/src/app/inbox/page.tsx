import { competitions } from "@desiauction/db";
import {
  EmptyState,
  IconBell,
  IconCheckCircle,
  IconCog,
  IconGavel,
  IconMegaphone,
  IconShieldCheck,
  IconUsers,
  SectionCard,
} from "@desiauction/ui";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";

import { detailOf } from "../../lib/inbox-events";
import { currentSession } from "../../server/auth/actions";
import { systemDb } from "../../server/db";
import { inboxState, listInboxEvents } from "../../server/auth/security-events";
import { rolesOf } from "../../server/roles/roles";
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
// listInboxEvents (the ledger minus what the person switched off). Read state
// is the person's own watermark on the server (PR16), the same on every device.
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/inbox");
  }
  // "Show older": the page before this timestamp. Anything unparseable is page 1.
  const beforeRaw = (await searchParams)["before"];
  const beforeAt = beforeRaw === undefined ? null : new Date(beforeRaw);
  const before = beforeAt !== null && !Number.isNaN(beforeAt.getTime()) ? beforeAt : undefined;
  const [events, roles, state] = await Promise.all([
    listInboxEvents(session.personId, WINDOW, before),
    rolesOf(session.personId),
    inboxState(session.personId),
  ]);
  const oldest = events[events.length - 1];
  const olderHref =
    events.length === WINDOW && oldest !== undefined
      ? `/inbox?before=${encodeURIComponent(oldest.at.toISOString())}`
      : null;
  const organizerOnly = roles.organizes.length > 0 && !roles.plays;
  /*
   * The rail says what lands for THIS person (round 4): an owner and an
   * auctioneer were told "Which team bought you". Player kinds for someone who
   * plays — or a brand-new account, which is most likely a player — owner and
   * auctioneer kinds for those roles, account alerts for everyone.
   */
  const owner = roles.owns.length > 0;
  const conductor = roles.conducts.length > 0;
  const showPlayer = roles.plays || (!owner && !conductor && !organizerOnly);
  const named = await competitionsNamed(
    events.map((event) => competitionIdOf(event.meta) ?? "").filter((id) => id !== ""),
  );
  return (
    <main className="inbox">
      <div className="inbox-main">
        <SectionCard
          icon={<IconBell />}
          title="All notifications"
          description={
            events.length === 0
              ? "Registration decisions, auction results and account alerts land here."
              : `${String(events.length)} ${events.length === 1 ? "notice" : "notices"} · newest first`
          }
          action={
            <Link
              href="/account?section=notifications"
              className="inbox-settings"
              aria-label="Notification settings"
            >
              <IconCog size={16} aria-hidden />
              <span className="inbox-settings-text">Notification settings</span>
            </Link>
          }
          flush={events.length > 0}
        >
          {events.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title="Nothing yet"
              description="New notices appear here the moment they happen."
            />
          ) : (
            <InboxList
              personId={session.personId}
              seenBefore={state.seenAt?.toISOString() ?? null}
              olderHref={olderHref}
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
        </SectionCard>
      </div>
      {/*
       * WHAT LANDS HERE (wow pass, round 2). The list stopped at 960px and left
       * the right third of a laptop blank; the rail now says what kinds of
       * notice arrive, and where the ones that do not (sign-ins) went.
       */}
      <aside className="inbox-rail" aria-labelledby="inbox-rail-title">
        <h2 id="inbox-rail-title" className="inbox-rail-title">
          What lands here
        </h2>
        {/* An organizer who does not play was told "which team bought you".
            Their clubs' work lives on each season's tabs; the inbox is for
            what happens to THEM — said so, with the door to the seasons. */}
        {organizerOnly ? (
          <p className="inbox-foot" data-testid="inbox-organizer-note">
            Your clubs&apos; work — registrations, auction nights, fixtures — lives on each
            season&apos;s own tabs. This inbox is for things that happen to you.{" "}
            <Link href="/tournaments">Your tournaments</Link>
          </p>
        ) : null}
        <ul className="inbox-kinds">
          {showPlayer ? (
            <>
              <li>
                <IconCheckCircle size={20} aria-hidden />
                <span>
                  <strong>Registration decisions</strong>
                  The moment the organizer decides on your entry.
                </span>
              </li>
              <li>
                <IconGavel size={20} aria-hidden />
                <span>
                  <strong>Auction results</strong>
                  Which team bought you, and for how much.
                </span>
              </li>
              <li>
                <IconUsers size={20} aria-hidden />
                <span>
                  <strong>Your team</strong>
                  Named captain, squad set, picked in a lineup.
                </span>
              </li>
            </>
          ) : null}
          {owner ? (
            <li>
              <IconUsers size={20} aria-hidden />
              <span>
                <strong>Your squad</strong>
                The team you own — invites, and its squad sheet once the auction settles.
              </span>
            </li>
          ) : null}
          {conductor ? (
            <li>
              <IconMegaphone size={20} aria-hidden />
              <span>
                <strong>Auction nights you run</strong>
                When a club names you its auctioneer, and changes to that night.
              </span>
            </li>
          ) : null}
          <li>
            <IconShieldCheck size={20} aria-hidden />
            <span>
              <strong>Account alerts</strong>
              Changes to your name, number, email or devices.
            </span>
          </li>
        </ul>
        {/* Where the sign-ins went: routine sign-ins and code requests are kept
            off this list (server/auth/inbox-filter.ts) and live in the
            account's security log — said here, so they do not seem lost. */}
        <p className="inbox-foot">
          Sign-ins and sign-in codes are in{" "}
          <Link href="/account?section=security#activity" data-testid="inbox-signins-link">
            Account → Security activity
          </Link>
          .
        </p>
        {/* One link per destination (round 3B): notification settings is the
            gear in the page head, not a second link here. */}
      </aside>
    </main>
  );
}
