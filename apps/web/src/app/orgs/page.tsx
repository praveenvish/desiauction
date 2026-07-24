import { Badge, Card } from "@desiauction/ui";
import Link from "next/link";

import { FormDialog } from "../../components/form-dialog";
import { PageAction } from "../../components/shell/page-action";
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

/** "1 tourn" / "3 tourns" — the design's abbreviation, pluralised honestly. */
function count(value: number, singular: string, plural: string): string {
  return value === 1 ? singular : plural;
}

export default async function OrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const [orgs, params] = await Promise.all([myOrgCards(), searchParams]);
  return (
    <main className="orgs">
      <div className="orgs-stack">
        <PageAction>
          <FormDialog
            title="New organization"
            triggerLabel="+ New organization"
            size="sm"
            triggerTestId="new-org"
          >
            <CreateOrgForm />
          </FormDialog>
        </PageAction>
        {params.invite === "invalid" ? (
          <p className="orgs-error" role="alert">
            That invite link is no longer valid — ask the organizer for a fresh one.
          </p>
        ) : null}

        {/* One card holding rows, with the create affordance as the last row —
            the same shape the tournaments list uses, so the two rail
            destinations read as one product rather than two. */}
        <Card padding="none">
          <div className="org-rows" data-testid="orgs-list">
            {orgs.map((org) => (
              <Link key={org.id} href={`/org/${org.slug}`} className="org-row">
                <span className="org-monogram" aria-hidden>
                  {monogram(org.name)}
                </span>
                <span className="org-row-id">
                  <strong>{org.name}</strong>
                  <span className="org-slug">/{org.slug}</span>
                </span>
                <span className="org-stat">
                  <b>{org.tournaments}</b> {count(org.tournaments, "tourn", "tourns")}
                </span>
                <span className="org-stat">
                  <b>{org.teams}</b> {count(org.teams, "team", "teams")}
                </span>
                <Badge tone="neutral">{org.role}</Badge>
                <span className="org-row-go" aria-hidden>
                  →
                </span>
              </Link>
            ))}
            {/* The create affordance is the last row of the same list — one
                click opens the modal rather than scrolling to a pinned card. */}
            <FormDialog
              title="New organization"
              triggerLabel={
                <>
                  <span className="org-add-plus" aria-hidden>
                    +
                  </span>
                  Create an organization
                </>
              }
              triggerAsLink
              triggerClassName="org-row org-row--add"
              triggerTestId="create-org-row"
            >
              <CreateOrgForm />
            </FormDialog>
          </div>
        </Card>

        {orgs.length === 0 ? (
          <p className="orgs-hint">
            An organization is the club you run tournaments under. Create one, or ask an organizer
            for an invite link.
          </p>
        ) : null}
      </div>
    </main>
  );
}
