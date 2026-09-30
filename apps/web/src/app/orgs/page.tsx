import {
  Card,
  IconCalendar,
  IconChevronRight,
  IconShieldCheck,
  IconUsers,
  Pill,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormDialog } from "../../components/form-dialog";
import { currentSession } from "../../server/auth/actions";
import { nowWallClock } from "../../server/competition/fixtures";
import { tournamentsView, type SeasonRow } from "../../server/competition/tournament-actions";
import { myOrgCards } from "../../server/orgs/actions";
import { dateRange } from "../tournaments/season-card";
import { nextStep, seasonStage } from "../tournaments/season-stage";
import { StagePill } from "../tournaments/tournament-card";
import { CreateOrgForm } from "./create-org-form";
import "../tournaments/tournaments.css";
import "./orgs.css";

export const metadata = { title: "Clubs" };

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
/** A club card lists its newest seasons; the club page has the rest. */
const SEASONS_SHOWN = 3;

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
  const [orgs, params, view] = await Promise.all([myOrgCards(), searchParams, tournamentsView()]);
  /*
   * EACH CLUB SAYS WHAT IS HAPPENING IN IT. The card was a monogram and three
   * counts, and a separate "Latest seasons" card listed the same seasons with
   * dates only — no stage, no next step. A club's seasons now live in its card,
   * newest first, with the stage the Tournaments page uses (seasonStage) and
   * the one step a person is waited on, so the two pages cannot disagree.
   */
  const today = nowWallClock().slice(0, 10);
  const seasonsByOrg = new Map<string, SeasonRow[]>();
  for (const season of [...view.tournaments.flatMap((t) => t.seasons), ...view.standalone]) {
    const list = seasonsByOrg.get(season.orgId) ?? [];
    list.push(season);
    seasonsByOrg.set(season.orgId, list);
  }
  for (const list of seasonsByOrg.values()) {
    list.sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""));
  }

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
                Your club or academy comes first. Everything else hangs off it — your tournaments,
                your teams, your money and who is allowed to touch it. Most people need exactly one.
              </p>
              {/* Its OWN test id. `new-org` belongs to the router-provided page
                  action (app/@action/orgs) — and BOTH render when the list is
                  empty, which is the state every new account starts in. Sharing
                  the id made `getByTestId("new-org")` a strict-mode violation in
                  every spec that creates an org, which is most of the suite. */}
              <FormDialog
                title="New club"
                triggerLabel="Create your club"
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
            One create door: the page's "+ New club" (round 2 dropped the
            dashed tile that repeated it). */}
        {/* A club or two beside their latest seasons (round 5A): stacked, one
            club card and a one-row list ended the page at y≈400 with the right
            two-thirds of the canvas blank. Many clubs keep the full-width grid. */}
        <div className="orgs-duo" data-duo={orgs.length === 1 ? "" : undefined}>
          <div className="org-cards da-stagger" data-testid="orgs-list">
            {orgs.map((org) => {
              const seasons = seasonsByOrg.get(org.id) ?? [];
              const shown = seasons.slice(0, SEASONS_SHOWN);
              return (
                <section
                  key={org.id}
                  className="org-card org-club"
                  data-testid={`org-club-${org.slug}`}
                >
                  <Link
                    href={`/org/${org.slug}`}
                    className="org-club-head"
                    // Named for where it GOES; the figures are decoration for
                    // assistive technology (the old row read as one sentence).
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
                  {shown.length === 0 ? (
                    <p className="org-club-none">No season yet — open the club to start one.</p>
                  ) : (
                    <ul className="org-club-seasons" aria-label={`${org.name} seasons`}>
                      {shown.map((season) => {
                        const step = nextStep(season, today);
                        return (
                          <li key={season.id}>
                            <Link
                              href={step?.urgent === true ? step.href : `/seasons/${season.slug}`}
                              className="org-season"
                              data-testid={`org-season-${season.slug}`}
                            >
                              <span className="org-season-name">
                                <strong>{season.name}</strong>
                                <span>
                                  {[dateRange(season.startsOn, season.endsOn), season.location]
                                    .filter((part): part is string => part !== null && part !== "")
                                    .join(" · ")}
                                </span>
                              </span>
                              <StagePill stage={seasonStage(season, today)} />
                              {step?.urgent === true ? (
                                <span className="org-season-step">{step.label}</span>
                              ) : (
                                <IconChevronRight size={16} aria-hidden className="org-season-go" />
                              )}
                            </Link>
                          </li>
                        );
                      })}
                      {seasons.length > shown.length ? (
                        <li>
                          <Link href={`/org/${org.slug}`} className="org-season-more">
                            All {seasons.length} seasons
                          </Link>
                        </li>
                      ) : null}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>

          {orgs.length === 1 ? (
            // One club: the card sits beside when a second one makes sense.
            // The header's "New club" stays the door (round 2 dropped a
            // dashed tile that repeated it).
            <aside className="org-another" data-testid="orgs-another">
              <h2>Running more than one club?</h2>
              <p>
                A club holds its own tournaments, teams, money and people. Most organizers need one
                — start another only for a separate academy or league, from{" "}
                <strong>New club</strong> above.
              </p>
            </aside>
          ) : null}
        </div>
      </div>
    </main>
  );
}
