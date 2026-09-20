import {
  Card,
  IconCalendar,
  IconChevronRight,
  IconPlus,
  IconShieldCheck,
  IconUsers,
  Pill,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormDialog } from "../../components/form-dialog";
import { currentSession } from "../../server/auth/actions";
import { myOrgCards } from "../../server/orgs/actions";
import { CreateOrgForm } from "./create-org-form";
import "./orgs.css";

export const metadata = { title: "Organizations · DesiAuction" };

/**
 * "Malad Cricket Club" → "MC". Two initials max.
 *
 * Takes the first code point rather than `charAt(0)` so a name outside the BMP
 * keeps its whole character instead of half a surrogate pair; for Devanagari
 * this lands on the base consonant, which is the initial a reader expects.
 */
function monogram(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => {
      const first = word.codePointAt(0);
      return first === undefined ? "" : String.fromCodePoint(first);
    });
  return initials.join("").toUpperCase() || "—";
}

/**
 * "1 season" / "3 seasons".
 *
 * "tourn"/"tourns" is not a word in any register — not the product's, not
 * cricket's, not English's — and it abbreviated the one count that stays zero
 * for anyone running one-off seasons.
 */
function count(value: number, singular: string): string {
  return value === 1 ? singular : `${singular}s`;
}

export default async function OrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  // Every other console entry (account, tournaments, home, money) redirects
  // signed-out visitors with `?next=` so they land back here after login.
  // This page relied on the shared `requireSession()` inside the orgs actions
  // module, which redirects bare to `/login` — losing the destination. Guard
  // here explicitly, matching the sibling pages, before the same-shaped
  // `myOrgCards()` call underneath.
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/orgs");
  }
  const [orgs, params] = await Promise.all([myOrgCards(), searchParams]);

  /* Empty was two interactive elements and ~850px of grey: a "+ New
     organization" button in the page-action slot, a "Create an organization"
     row, and one grey sentence — for a reader who at that moment does not know
     what an organization IS or whether they are supposed to have one. The empty
     state now teaches the concept, states the expected number, and names the
     other way in. */
  if (orgs.length === 0) {
    return (
      <main className="orgs">
        <div className="orgs-stack">
          {params.invite === "invalid" ? (
            <p className="orgs-error" role="alert">
              That invite link is no longer valid — ask the organizer for a fresh one.
            </p>
          ) : null}
          <Card>
            <div className="orgs-blank" data-testid="orgs-empty">
              <h2>Start with your club</h2>
              <p>
                An organization is your club or academy. Everything else hangs off it — your
                tournaments, your teams, your money and who is allowed to touch it. Most people need
                exactly one.
              </p>
              {/* Its OWN test id. `new-org` belongs to the router-provided page
                  action (app/@action/orgs) — and BOTH render when the list is
                  empty, which is the state every new account starts in. Sharing
                  the id made `getByTestId("new-org")` a strict-mode violation in
                  every spec that creates an org, which is most of the suite. */}
              <FormDialog
                title="New organization"
                triggerLabel="Create your organization"
                size="touch"
                triggerTestId="new-org-empty"
              >
                <CreateOrgForm />
              </FormDialog>
              <p className="orgs-hint">
                Already in someone&apos;s club? Ask them for an invite link.
              </p>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="orgs">
      <div className="orgs-stack">
        {/* The primary action moved to `app/@action/orgs/page.tsx` — same
            control, resolved by the router so it is in the server render. */}
        {params.invite === "invalid" ? (
          <p className="orgs-error" role="alert">
            That invite link is no longer valid — ask the organizer for a fresh one.
          </p>
        ) : null}

        {/* One card per club (founder mockups): the crest, the name and the
            reader's standing, then the three figures that say how big it is.
            The create affordance is the last card of the same grid. */}
        <div className="org-cards" data-testid="orgs-list">
          {orgs.map((org) => (
            <Link
              key={org.id}
              href={`/org/${org.slug}`}
              className="org-card"
              // Named for where it GOES; the figures inside are decoration for
              // assistive technology (the old row read as one long sentence).
              aria-label={`${org.name} — you are ${org.role === "Owner" ? "an owner" : `a ${org.role.toLowerCase()}`}`}
            >
              <span className="org-card-top" aria-hidden>
                <span className="org-monogram">{monogram(org.name)}</span>
                <span className="org-card-id">
                  <strong>{org.name}</strong>
                  <span className="org-slug">/{org.slug}</span>
                </span>
                <Pill tone={org.role === "Owner" ? "gold" : "neutral"}>{org.role}</Pill>
              </span>
              <span className="org-card-figures" aria-hidden>
                <span className="org-card-figure">
                  <IconCalendar size={16} />
                  <b>{org.seasons}</b> {count(org.seasons, "season")}
                </span>
                <span className="org-card-figure">
                  <IconShieldCheck size={16} />
                  <b>{org.teams}</b> {count(org.teams, "team")}
                </span>
                <span className="org-card-figure">
                  <IconUsers size={16} />
                  <b>{org.members}</b> {count(org.members, "member")}
                </span>
                <span className="org-card-go">
                  <IconChevronRight size={18} />
                </span>
              </span>
            </Link>
          ))}
          {/* One click opens the modal rather than scrolling to a pinned card. */}
          <FormDialog
            title="New organization"
            triggerLabel={
              <>
                <span className="org-add-plus" aria-hidden>
                  <IconPlus size={20} />
                </span>
                <span className="org-add-text">
                  <strong>Create an organization</strong>
                  <span>A club or academy of your own.</span>
                </span>
              </>
            }
            triggerAsLink
            triggerClassName="org-card org-card--add"
            triggerTestId="create-org-row"
          >
            <CreateOrgForm />
          </FormDialog>
        </div>
      </div>
    </main>
  );
}
