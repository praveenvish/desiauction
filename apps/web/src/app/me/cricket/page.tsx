import { formatPaiseINR, paise, roleLabel } from "@desiauction/core";
import { Badge, Card, EmptyState, PageIntro, PlayerImage, Stat, StatRow } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentSession } from "../../../server/auth/actions";
import { playerCareer, type CareerSeason } from "../../../server/player/career";
import { playerProfileFor, profileCompletenessFor } from "../../../server/player/profile";
import { formatDate } from "../../../lib/format-date";
import "./me-cricket.css";

export const metadata = { title: "My cricket · DesiAuction" };

/**
 * THE PLAYER'S OWN CAREER (PI-1 P5) — /me/cricket.
 *
 * Self-scoped by identity, not by grant (doc 37: players are subjects with a
 * window). Everything here is the person's own: their seasons, their teams,
 * their hammer prices. The shell owns the h1 ("My cricket", nav.ts); this page
 * opens with content.
 */

const REG_TONE: Record<string, "success" | "info" | "warning" | "neutral"> = {
  approved: "success",
  submitted: "info",
  waitlisted: "warning",
  rejected: "neutral",
  withdrawn: "neutral",
};

function auctionBadge(
  season: CareerSeason,
): { tone: "success" | "info" | "neutral"; text: string } | null {
  const outcome = season.auction;
  if (outcome === null) {
    return null;
  }
  if (outcome.kind === "sold") {
    return { tone: "success", text: `Sold · ${formatPaiseINR(paise(outcome.soldPrice))}` };
  }
  if (outcome.kind === "icon") {
    return { tone: "info", text: "Icon player" };
  }
  if (outcome.kind === "retained") {
    return { tone: "info", text: "Retained" };
  }
  return { tone: "neutral", text: "Unsold" };
}

export default async function MyCricketPage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/me/cricket");
  }
  const [career, profile, completeness] = await Promise.all([
    playerCareer(session.personId),
    playerProfileFor(session.personId),
    profileCompletenessFor(session.personId),
  ]);

  return (
    <main className="me-cricket">
      <PageIntro />
      <div className="me-cricket-stack">
        <Card className="me-cricket-head" data-testid="career-header">
          <PlayerImage
            name={session.name ?? "Player"}
            seed={session.personId}
            size="md"
            shape="round"
          />
          <div className="me-cricket-id">
            <h2>{session.name ?? "—"}</h2>
            <p className="me-cricket-sub">
              {[
                profile.defaultRole !== null ? roleLabel(profile.defaultRole) : null,
                profile.location,
              ]
                .filter((part): part is string => part !== null)
                .join(" · ") || "Add your role and city on the Account page."}
            </p>
          </div>
          {completeness.done < completeness.total ? (
            <Link href="/account" className="me-cricket-complete">
              Profile {completeness.done}/{completeness.total} — finish it
            </Link>
          ) : null}
        </Card>

        {career.seasons.length === 0 ? (
          <EmptyState
            title="No seasons yet"
            description="When you register for a tournament, it shows up here — and after auction night, so does your result."
            action={<Link href="/c">Find a tournament</Link>}
          />
        ) : (
          <>
            <StatRow label="Career totals">
              <Stat label="Seasons" value={String(career.totals.seasons)} />
              <Stat label="Teams" value={String(career.totals.teams)} />
              <Stat label="Times sold" value={String(career.totals.soldCount)} />
              <Stat
                label="Highest price"
                value={
                  career.totals.highestPrice !== null
                    ? formatPaiseINR(paise(career.totals.highestPrice))
                    : "—"
                }
              />
            </StatRow>

            <Card data-testid="career-seasons">
              <h2 className="me-cricket-h2">Seasons</h2>
              <ul className="me-cricket-seasons">
                {career.seasons.map((season) => {
                  const outcome = auctionBadge(season);
                  return (
                    <li key={season.registrationId}>
                      <Link
                        href={`/seasons/${season.competitionSlug}/register`}
                        className="me-cricket-season"
                      >
                        <span className="me-cricket-season-text">
                          <strong>
                            {season.tournamentName !== null
                              ? `${season.tournamentName} · ${season.competitionName}`
                              : season.competitionName}
                          </strong>
                          <span>
                            {[
                              season.orgName,
                              season.startsOn !== null ? formatDate(season.startsOn) : null,
                              roleLabel(season.role),
                              season.teamName,
                              season.isCaptain
                                ? "Captain"
                                : season.isViceCaptain
                                  ? "Vice-captain"
                                  : null,
                            ]
                              .filter((part): part is string => part !== null)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="me-cricket-season-badges">
                          {outcome !== null ? (
                            <Badge tone={outcome.tone}>{outcome.text}</Badge>
                          ) : (
                            <Badge tone={REG_TONE[season.status] ?? "neutral"}>
                              {season.status}
                            </Badge>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
