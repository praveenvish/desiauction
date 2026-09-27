import { formatAmount, paise, roleLabelIn, sportPack, type MoneyUnit } from "@desiauction/core";
import {
  EmptyState,
  HeroBanner,
  IconArrowRight,
  IconGavel,
  IconPin,
  IconRupee,
  IconTrophy,
  IconUsers,
  IconWallet,
  PlayerImage,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
  TeamChip,
} from "@desiauction/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { currentSession } from "../../../server/auth/actions";
import { HeroChip, HeroStatus } from "../../../components/season-hero/season-hero";
import { playerCareer } from "../../../server/player/career";
import {
  ownPhotoUrl,
  playerProfileFor,
  profileCompletenessFor,
  sportProfileFor,
} from "../../../server/player/profile";
import { formatDate } from "../../../lib/format-date";
import { verdictOf } from "../registration-card";
import "../me.css";

/**
 * ONE SPORT'S CAREER (SP-1 Phase 3).
 *
 * `/me/cricket` still resolves — it is this route with `sport = "cricket"` — so
 * every link and bookmark that existed before Phase 3 keeps working, and
 * `/me/football` now exists beside it. A person's cricket seasons and their
 * football seasons are two stories, and this page tells one of them.
 */
export async function generateMetadata({ params }: { params: Promise<{ sport: string }> }) {
  const pack = sportPack((await params).sport);
  return { title: pack === null ? "Not found" : `My ${pack.label.toLowerCase()} · DesiAuction` };
}

/**
 * THE PLAYER'S OWN CAREER (PI-1 P5) — /me/cricket.
 *
 * Self-scoped by identity, not by grant (doc 37: players are subjects with a
 * window). Everything here is the person's own: their seasons, their teams,
 * their hammer prices. The shell owns the h1 ("My cricket", nav.ts); this page
 * opens with content.
 */

// Each season in its own unit (0091) — a points league's price is not rupees.
const money = (value: number, unit: MoneyUnit): string => formatAmount(paise(value), unit);

export default async function MySportPage({ params }: { params: Promise<{ sport: string }> }) {
  const pack = sportPack((await params).sport);
  if (pack === null) {
    // A sport this platform has no pack for is ABSENT, not empty.
    notFound();
  }
  const session = await currentSession();
  if (session === null) {
    redirect(`/login?next=/me/${pack.key}`);
  }
  const [career, sportProfile, profile, completeness, photoUrl] = await Promise.all([
    playerCareer(session.personId, pack.key),
    sportProfileFor(session.personId, pack.key),
    playerProfileFor(session.personId),
    profileCompletenessFor(session.personId),
    ownPhotoUrl(session.personId),
  ]);

  const role =
    sportProfile.defaultRole !== null ? roleLabelIn(pack, sportProfile.defaultRole) : null;
  const attributeLabel = (attribute: (typeof pack.attributes)[number]): string | null => {
    const value = sportProfile.attributes[attribute.key];
    return value === undefined
      ? null
      : (attribute.options.find((option) => option.key === value)?.label ?? null);
  };
  const playUnset = role === null && pack.attributes.every((a) => attributeLabel(a) === null);
  const hasArmband = career.seasons.some(
    (season) => season.isCaptain || season.isViceCaptain || season.auction?.kind === "captain",
  );

  return (
    <main className="me">
      <HeroBanner
        testId="career-header"
        crest={
          <span className="me-crest-photo">
            <PlayerImage
              name={session.name ?? "Player"}
              seed={session.personId}
              src={photoUrl}
              size="lg"
              fluid
              decorative
            />
          </span>
        }
        eyebrow={<HeroStatus>{pack.label}</HeroStatus>}
        title={session.name ?? "—"}
        // Nothing to show is nothing shown: "Add your role and city…" said
        // what the "Profile N of M" action beside it already says.
        meta={
          role === null && profile.location === null
            ? []
            : [
                ...(role !== null ? [<HeroChip key="role">{role}</HeroChip>] : []),
                ...(profile.location !== null
                  ? [
                      <>
                        <IconPin />
                        {profile.location}
                      </>,
                    ]
                  : []),
              ]
        }
        actions={
          <Link
            href={completeness.done < completeness.total ? "/account" : "/me"}
            className="sh-ghost"
          >
            {completeness.done < completeness.total
              ? `Profile ${String(completeness.done)} of ${String(completeness.total)} — finish it`
              : "All my sports"}
            <IconArrowRight size={14} />
          </Link>
        }
        sideAlign="start"
      />

      {career.seasons.length === 0 ? (
        <SectionCard icon={<IconTrophy />} title="Seasons">
          <EmptyState
            headingLevel={3}
            title="No seasons yet"
            description="When you register for a tournament, it shows up here — and after auction night, so does your result."
            action={<Link href="/c">Find a tournament</Link>}
          />
        </SectionCard>
      ) : (
        <>
          <StatGrid testId="career-totals">
            <StatCard
              icon={<IconTrophy />}
              tone="gold"
              value={String(career.totals.seasons)}
              label={career.totals.seasons === 1 ? "Season" : "Seasons"}
            />
            <StatCard
              icon={<IconUsers />}
              tone="gold"
              value={String(career.totals.teams)}
              label={career.totals.teams === 1 ? "Team" : "Teams"}
            />
            <StatCard
              icon={<IconGavel />}
              tone="gold"
              value={String(career.totals.soldCount)}
              label="Times sold"
            />
            <StatCard
              // ₹ only over a rupee price: "Highest price 50,000 pts" beside a
              // rupee sign read as money to a points-league player (0091).
              icon={career.totals.highestUnit === "inr" ? <IconRupee /> : <IconWallet />}
              tone="gold"
              value={
                career.totals.highestPrice !== null
                  ? money(career.totals.highestPrice, career.totals.highestUnit)
                  : "—"
              }
              label="Highest price"
            />
          </StatGrid>

          {/* THE CAREER, AS A RECORD (round 4). This page had become a copy
              of /me — same hero, same cards, the same squad rail beside them.
              /me is the overview across sports; this is one sport's ledger:
              one line per season, the team, the role, the price and the
              armband, full width, oldest first. The squad lives on /home and
              /me. */}
          <SectionCard
            icon={<IconTrophy />}
            title="Season by season"
            description={`${String(career.seasons.length)} in ${pack.label.toLowerCase()}, oldest first`}
            flush
            data-testid="career-seasons"
          >
            <div
              className="me-career"
              role="table"
              aria-label={`${pack.label} seasons`}
              // No armband ever worn: the column stands down rather than
              // printing a dash down every row (round 5).
              data-armband={hasArmband ? "" : undefined}
            >
              <div className="me-career-row me-career-head" role="row">
                <span role="columnheader">Season</span>
                <span role="columnheader">Team</span>
                <span role="columnheader">Role</span>
                <span role="columnheader">Auction</span>
                {hasArmband ? <span role="columnheader">Armband</span> : null}
              </div>
              {career.seasons.map((season) => {
                const verdict = verdictOf(season, money);
                const armband =
                  season.isCaptain || season.auction?.kind === "captain"
                    ? "Captain"
                    : season.isViceCaptain
                      ? "Vice-captain"
                      : null;
                return (
                  <div key={season.registrationId} className="me-career-row" role="row">
                    <span className="me-career-season" role="cell">
                      <Link href={`/seasons/${season.competitionSlug}/register`}>
                        {season.tournamentName !== null &&
                        season.tournamentName !== season.competitionName
                          ? `${season.tournamentName} · ${season.competitionName}`
                          : season.competitionName}
                      </Link>
                      <span className="me-career-sub">
                        {[
                          season.orgName,
                          season.startsOn !== null ? formatDate(season.startsOn) : null,
                        ]
                          .filter((part): part is string => part !== null && part !== "")
                          .join(" · ")}
                      </span>
                    </span>
                    <span role="cell" data-label="Team">
                      {season.teamName !== null ? (
                        <TeamChip color={season.teamColor}>{season.teamName}</TeamChip>
                      ) : (
                        <span className="me-career-none">No team</span>
                      )}
                    </span>
                    <span role="cell" data-label="Role" className="me-career-role">
                      {roleLabelIn(pack, season.role) || "—"}
                    </span>
                    <span role="cell" data-label="Auction">
                      <Pill tone={verdict.tone} dot>
                        {verdict.label}
                      </Pill>
                    </span>
                    {hasArmband ? (
                      <span role="cell" data-label="Armband" className="me-career-armband">
                        {armband ?? <span className="me-career-none">—</span>}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {/* HOW YOU PLAY — this sport's own answers (role and styles), the
              second thing a career page holds that /me does not. */}
          <SectionCard
            icon={<IconUsers />}
            title="How you play"
            description={`Your ${pack.label.toLowerCase()} profile — every new registration starts from it.`}
            {...(playUnset
              ? {}
              : {
                  action: (
                    <Link href="/account?section=player#sports" className="me-link">
                      Edit <IconArrowRight size={14} aria-hidden />
                    </Link>
                  ),
                })}
            data-testid="career-profile"
          >
            {playUnset ? (
              // Nothing set: one line and one way to set it, not "Not set"
              // three times over (round 5).
              <div className="me-play-empty">
                <p>
                  Nothing set yet. Your role and styles fill in every registration form for you.
                </p>
                <Link href="/account?section=player#sports" className="me-link">
                  Add how you play <IconArrowRight size={14} aria-hidden />
                </Link>
              </div>
            ) : (
              <dl className="me-play">
                <div>
                  <dt>Role</dt>
                  <dd data-empty={role === null ? "true" : undefined}>{role ?? "Not set"}</dd>
                </div>
                {pack.attributes.map((attribute) => {
                  const label = attributeLabel(attribute);
                  return (
                    <div key={attribute.key}>
                      <dt>{attribute.label}</dt>
                      <dd data-empty={label === null ? "true" : undefined}>{label ?? "Not set"}</dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </SectionCard>
        </>
      )}
    </main>
  );
}
