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
  PlayerImage,
  SectionCard,
  StatCard,
  StatGrid,
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
import { RegistrationCard } from "../registration-card";
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
        meta={
          role === null && profile.location === null
            ? [<>Add your role and city on the Account page.</>]
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
              ? `Profile ${String(completeness.done)}/${String(completeness.total)} — finish it`
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
              tone="blue"
              value={String(career.totals.teams)}
              label={career.totals.teams === 1 ? "Team" : "Teams"}
            />
            <StatCard
              icon={<IconGavel />}
              tone="purple"
              value={String(career.totals.soldCount)}
              label="Times sold"
            />
            <StatCard
              icon={<IconRupee />}
              tone="green"
              value={
                career.totals.highestPrice !== null
                  ? money(career.totals.highestPrice, career.totals.highestUnit)
                  : "—"
              }
              label="Highest price"
            />
          </StatGrid>

          <SectionCard
            icon={<IconTrophy />}
            title="Seasons"
            description={`${String(career.seasons.length)} in ${pack.label.toLowerCase()}, oldest first`}
            data-testid="career-seasons"
          >
            <ul className="me-regs">
              {career.seasons.map((season) => (
                <li key={season.registrationId}>
                  <RegistrationCard
                    season={season}
                    eyebrow={season.startsOn !== null ? formatDate(season.startsOn) : pack.label}
                    subline={[season.orgName, roleLabelIn(pack, season.role)]
                      .filter((part) => part !== "")
                      .join(" · ")}
                    money={money}
                  />
                </li>
              ))}
            </ul>
          </SectionCard>
        </>
      )}
    </main>
  );
}
