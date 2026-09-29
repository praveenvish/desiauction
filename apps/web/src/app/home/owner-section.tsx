import {
  ButtonLink,
  IconArrowRight,
  IconCalendar,
  IconChart,
  IconTrophy,
  Pill,
  PlayerImage,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";

import { lineupWords } from "../../lib/lineup-words";
import { moneyFormat } from "../../lib/money";
import { planView } from "../../server/auction/owner-plan-actions";
import { publicTeam, teamSlugOf } from "../../server/competition/public";
import { seasonUnit } from "../../server/competition/season-unit";
import { teamSeason, type TeamSeason, type TeamSeasonMatch } from "../../server/player/career";
import { dateTile, formatDayDate, formatWallTime, istCalendarDate } from "../../lib/format-date";
import type { OwnedTeam } from "../../server/roles/roles";
import type { Tone } from "./home-parts";
import "./home-duo.css";
import "./owner-home.css";

/**
 * A TEAM OWNER'S HOME HALF (launch polish, Phase 2).
 *
 * An owner used to land on the organizer's dashboard for the whole club and
 * find nothing about the one team they run. This is that team: what is left in
 * the purse, how full the squad is, how far the plan has got — and the three
 * doors an owner actually uses.
 *
 * The figures come from `planView`, the same gated read the plan page uses, so
 * nothing here is visible that the plan page would not show this person. When
 * planning is switched off for the auction (or the gate declines), the section
 * keeps the doors and drops the figures rather than guessing them.
 *
 * Dressed in the organizer's kit — a section card, stat cards with the same
 * thin progress bars, pills for status — so an owner's home reads as the same
 * product as the club's, only narrower.
 */
const STATUS: Record<string, { label: string; tone: Tone; dot?: boolean }> = {
  scheduled: { label: "Auction coming up", tone: "neutral" },
  live: { label: "Auction live", tone: "green", dot: true },
  paused: { label: "Auction paused", tone: "amber", dot: true },
  completed: { label: "Auction finished", tone: "green" },
  reconciled: { label: "Auction finished", tone: "green" },
};

/**
 * The line under "12 / 12". "at least 12" beside a full squad of 12 read as a
 * shortfall; when the minimum IS the maximum there is one number that matters,
 * and a full squad is simply complete.
 */
export function squadHint(size: number, min: number, max: number): string {
  if (size >= max) return "Squad complete";
  if (min === max) return `full squad ${String(max)}`;
  return `at least ${String(min)}`;
}

/**
 * The purse as one graphic: the gold arc is what was SPENT, the quiet track
 * what is left. It drew the left share in gold, so a finished night (10% left)
 * was a ring 90% grey that read as a loading spinner (round 2).
 */
function PurseRing({ left, whole }: { left: number; whole: number }) {
  const share = whole <= 0 ? 0 : Math.max(0, Math.min(1, left / whole));
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ow-ring" viewBox="0 0 72 72" width="72" height="72" aria-hidden>
      <circle cx="36" cy="36" r={r} className="ow-ring-track" />
      <circle
        cx="36"
        cy="36"
        r={r}
        className="ow-ring-spent"
        strokeDasharray={`${String(c * (1 - share))} ${String(c)}`}
        transform="rotate(-90 36 36)"
      />
    </svg>
  );
}

/** Faces a phone strip holds before the rest fold into "+N". */
const PHONE_FACES = 8;

/** Two letters for the crest. */
function crestOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/*
 * WOW PASS (2026-09-25). One card holding three bordered stat cards with a
 * row of 28px buttons under them, then 590px of nothing — and "Purse left"
 * and "Spent" were the same fact twice. The team is now a hero object: crest,
 * name and state; the purse as one ring (left vs spent); the squad count; the
 * squad's faces as a strip; and the doors. No card inside a card.
 */
export async function OwnerSection({ team }: { team: OwnedTeam }) {
  const over = team.auctionStatus === "completed" || team.auctionStatus === "reconciled";
  const today = istCalendarDate();
  const [plan, unit, squad, season] = await Promise.all([
    planView(team.competitionSlug, team.teamId),
    seasonUnit(team.competitionSlug),
    // The whole squad, pre-signed included, from the read the season's public
    // team page publishes (null for a private season — the strip then shows
    // the night's buys, as before).
    publicTeam(team.competitionSlug, teamSlugOf(team.teamName)),
    // After the night, the team's season — the owner's own team, from roles.
    over ? teamSeason(team.teamId, today) : Promise.resolve(null),
  ]);
  /** The season is on once the club has published a match for this team. */
  const seasonOn =
    season !== null && season.upcoming.length + season.awaiting.length + season.results.length > 0
      ? season
      : null;
  // The purse counts in the season's own unit — rupees or points (0091).
  const money = moneyFormat(unit);
  const base = `/seasons/${team.competitionSlug}`;
  const live = team.auctionStatus === "live" || team.auctionStatus === "paused";
  const status =
    seasonOn !== null
      ? {
          label:
            seasonOn.place !== null
              ? `Season on · ${ordinal(seasonOn.place.position)}`
              : "Season on",
          tone: "green" as Tone,
          dot: true,
        }
      : (STATUS[team.auctionStatus] ?? { label: "Auction", tone: "neutral" });
  const squadHref = `${base}/teams?team=${encodeURIComponent(team.teamId)}`;
  const bought =
    plan === null
      ? []
      : plan.lots
          .filter((lot) => lot.status === "sold" && lot.soldToTeamId === team.teamId)
          .sort((a, b) => (b.soldPrice ?? 0) - (a.soldPrice ?? 0));
  /*
   * EVERY FACE THE "12/12" COUNTS (round 4): the strip showed the ten bought
   * beside a "12/12 Squad" figure. Pre-signed players lead, ringed, the way
   * /teams puts them first.
   */
  const faces =
    squad !== null && squad.members.length > 0
      ? squad.members.map((member) => ({
          key: member.registrationId,
          name: member.name,
          seed: member.registrationId,
          photoUrl: member.photoUrl,
          preSigned: member.pricePaise === null,
        }))
      : bought.map((lot) => ({
          key: lot.lotId,
          name: lot.playerName ?? "Player",
          seed: lot.registrationId,
          photoUrl: plan?.lotMedia[lot.lotId]?.photoUrl ?? null,
          preSigned: false,
        }));
  const shown = faces.slice(0, 12);
  const topBuy = bought[0];
  const preSignedCount = faces.filter((face) => face.preSigned).length;
  const titleId = `ow-${team.teamId}`;
  return (
    <>
      <section
        className="ow-hero"
        data-theme="floodlight"
        data-testid="home-owner"
        aria-labelledby={titleId}
      >
        <header className="ow-head">
          <span className="ow-crest" aria-hidden>
            {crestOf(team.teamName)}
          </span>
          <div className="ow-id">
            <p className="ow-kicker">My team · {team.competitionName}</p>
            <h2 id={titleId} className="ow-name">
              {team.teamName}
            </h2>
          </div>
          <Pill tone={status.tone} dot={status.dot === true}>
            {status.label}
          </Pill>
        </header>

        {seasonOn !== null ? <NextStrip season={seasonOn} today={today} /> : null}

        {seasonOn !== null ? (
          <dl className="ow-season-figs" data-testid="home-owner-figures">
            <div>
              <dt>won – lost</dt>
              <dd>
                {seasonOn.record.won} – {seasonOn.record.lost}
              </dd>
            </div>
            {seasonOn.place !== null ? (
              <div>
                <dt>in the table · {seasonOn.place.points} pts</dt>
                <dd>
                  {ordinal(seasonOn.place.position)} of {seasonOn.place.of}
                </dd>
              </div>
            ) : null}
            {plan !== null ? (
              <div>
                <dt>purse left of {money.ledger(plan.rules.pursePerTeam)}</dt>
                <dd>{money.compactFloor(plan.standing.purseRemaining)}</dd>
              </div>
            ) : null}
            {plan !== null ? (
              <div>
                <dt>
                  {squadHint(plan.standing.squadSize, plan.rules.squadMin, plan.rules.squadMax)}
                </dt>
                <dd>
                  {plan.standing.squadSize} / {plan.rules.squadMax}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : plan !== null ? (
          <div className="ow-figures" data-testid="home-owner-figures">
            <div className="ow-purse">
              <PurseRing left={plan.standing.purseRemaining} whole={plan.rules.pursePerTeam} />
              <div className="ow-figure">
                <span className="ow-value">{money.compactFloor(plan.standing.purseRemaining)}</span>
                <span className="ow-label">
                  Purse left
                  {/* Spent is the other half of the same ring, said once. */}
                  <span className="ow-hint">
                    {over
                      ? `${money.compact(plan.rules.pursePerTeam - plan.standing.purseRemaining)} spent of ${money.ledger(plan.rules.pursePerTeam)}`
                      : `of ${money.ledger(plan.rules.pursePerTeam)}`}
                  </span>
                </span>
              </div>
            </div>
            <div className="ow-figure">
              <span className="ow-value">
                {String(plan.standing.squadSize)}
                <span className="ow-of">/{String(plan.rules.squadMax)}</span>
              </span>
              <span className="ow-label">
                Squad
                <span className="ow-hint">
                  {squadHint(plan.standing.squadSize, plan.rules.squadMin, plan.rules.squadMax)}
                </span>
              </span>
            </div>
            {over && topBuy !== undefined && topBuy.soldPrice !== null ? (
              <div className="ow-figure" data-testid="home-owner-top-buy">
                <span className="ow-value">{money.compact(topBuy.soldPrice)}</span>
                <span className="ow-label">
                  Top buy
                  <span className="ow-hint">{topBuy.playerName ?? "Player"}</span>
                </span>
              </div>
            ) : null}
            {over ? null : (
              <Link className="ow-figure ow-figure-link" href={`${base}/auction/plan`}>
                <span className="ow-value">{String(plan.targets.length)}</span>
                <span className="ow-label">
                  {plan.targets.length === 1 ? "Target" : "Targets"} in my plan
                  <span className="ow-hint">only you can see it</span>
                </span>
              </Link>
            )}
          </div>
        ) : null}

        {shown.length > 0 ? (
          // ONE LINK PER DESTINATION (round 3B): the squad's door is the "My
          // squad" button below; the faces are a glance, not a second link.
          <div className="ow-squad">
            <ul className="ow-faces">
              {shown.map((face, index) => (
                <li
                  key={face.key}
                  title={face.preSigned ? `${face.name} · pre-signed` : face.name}
                  data-presigned={face.preSigned ? "true" : undefined}
                  // A phone strip holds eight faces; the rest fold into "+N".
                  data-fold={index >= PHONE_FACES ? "true" : undefined}
                >
                  <PlayerImage
                    name={face.name}
                    seed={face.seed}
                    src={face.photoUrl}
                    size="md"
                    shape="round"
                    fluid
                    decorative
                  />
                </li>
              ))}
              {shown.length > PHONE_FACES ? (
                <li className="ow-faces-fold" aria-hidden>
                  +{String(shown.length - PHONE_FACES)}
                </li>
              ) : null}
            </ul>
            <span className="ow-squad-more">
              {faces.length > shown.length
                ? `+${String(faces.length - shown.length)} more`
                : preSignedCount > 0
                  ? `${String(faces.length - preSignedCount)} bought · ${String(preSignedCount)} pre-signed`
                  : `${String(faces.length)} bought`}
            </span>
          </div>
        ) : null}

        <nav className="ow-links" aria-label={`${team.teamName} shortcuts`}>
          {/*
           * THE SQUAD, not the grid. "Team page" opened every team in the season
           * and left the owner to find their own; `?team=` opens theirs, with the
           * buy prices. After the auction it is the thing to look at — Fixtures
           * may well be empty for weeks — so it leads.
           */}
          {over ? (
            <>
              <ButtonLink href={squadHref} data-testid="home-owner-squad">
                My squad
                <IconArrowRight size={16} />
              </ButtonLink>
              <ButtonLink href={`${base}/fixtures`} variant="secondary">
                {seasonOn !== null ? "Schedule" : "Fixtures"}
              </ButtonLink>
              {seasonOn?.place !== null && seasonOn !== null ? (
                <ButtonLink href={`${base}/standings`} variant="secondary">
                  Table
                </ButtonLink>
              ) : null}
            </>
          ) : (
            <ButtonLink href={`${base}/auction/live`} variant={live ? "primary" : "secondary"}>
              {live ? "Enter the live room" : "Auction room"}
              <IconArrowRight size={16} />
            </ButtonLink>
          )}
          {over ? null : (
            <ButtonLink href={`${base}/auction/plan`} variant="secondary">
              My plan
            </ButtonLink>
          )}
          {over ? null : (
            <ButtonLink href={squadHref} variant="ghost" data-testid="home-owner-squad">
              My squad
            </ButtonLink>
          )}
        </nav>
      </section>
      {plan !== null && bought.length > 0 ? (
        <OwnerDuo
          teamId={team.teamId}
          bought={bought}
          roles={plan.roles}
          preSignedRoles={plan.preSignedRoles}
          media={plan.lotMedia}
          spent={plan.rules.pursePerTeam - plan.standing.purseRemaining}
          money={money}
          season={seasonOn}
          fixturesHref={`${base}/fixtures`}
          planHref={`${base}/auction/plan?team=${encodeURIComponent(team.teamId)}`}
          today={today}
        />
      ) : null}
    </>
  );
}

type Bought = NonNullable<Awaited<ReturnType<typeof planView>>>["lots"];

/**
 * THE SECOND OBJECT (wow pass, round 2). The hero says how much is left; the
 * two cards under it say what the money bought — the three dearest players,
 * and the squad's balance by role. Everything from the plan read above.
 */
function OwnerDuo({
  teamId,
  bought,
  roles,
  preSignedRoles,
  media,
  spent,
  money,
  season,
  fixturesHref,
  planHref,
  today,
}: {
  teamId: string;
  bought: Bought;
  roles: { key: string; label: string }[];
  preSignedRoles: string[];
  media: Record<string, { photoUrl: string | null } | undefined>;
  spent: number;
  money: ReturnType<typeof moneyFormat>;
  /** Once the season is on, the matches take the balance card's place. */
  season: TeamSeason | null;
  fixturesHref: string;
  planHref: string;
  today: string;
}) {
  const labelOf = (role: string | null): string =>
    role === null
      ? "Player"
      : (roles.find((r) => r.key === role)?.label ?? role.replace(/_/g, " "));
  const top = bought.slice(0, 3);
  const counts = new Map<string, number>();
  for (const role of [...bought.map((lot) => lot.role), ...preSignedRoles]) {
    if (role !== null) counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  const balance = roles
    .map((role) => ({ ...role, count: counts.get(role.key) ?? 0 }))
    .filter((row) => row.count > 0);
  const most = Math.max(1, ...balance.map((row) => row.count));
  // Where the money went: the role that took the biggest share of the spend.
  const spendByRole = new Map<string, number>();
  for (const lot of bought) {
    if (lot.role !== null)
      spendByRole.set(lot.role, (spendByRole.get(lot.role) ?? 0) + (lot.soldPrice ?? 0));
  }
  const [heaviestRole, heaviestSpend] = [...spendByRole.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0] ?? [null, 0];
  const heaviestShare = spent > 0 ? Math.round((heaviestSpend / spent) * 100) : 0;
  const average = bought.length === 0 ? 0 : Math.round(spent / bought.length);
  return (
    <div
      className="hd-duo"
      data-testid="home-owner-duo"
      data-season={season !== null ? "" : undefined}
    >
      <section className="hd-card" aria-labelledby={`hd-top-${teamId}`}>
        <div className="hd-head">
          <h2 id={`hd-top-${teamId}`} className="hd-title">
            <IconTrophy size={20} />
            Top buys
          </h2>
          {season !== null ? (
            <Link className="hd-link" href={planHref}>
              The night in full
              <IconArrowRight size={16} />
            </Link>
          ) : null}
        </div>
        <ol className="hd-rows">
          {top.map((lot, index) => (
            <li key={lot.lotId} className="hd-row" data-rank={index + 1}>
              <span className="hd-rank">{String(index + 1)}</span>
              <PlayerImage
                name={lot.playerName ?? "Player"}
                seed={lot.registrationId}
                src={media[lot.lotId]?.photoUrl ?? null}
                size="sm"
                shape="round"
                decorative
              />
              <span className="hd-who">
                <span className="hd-name">{lot.playerName ?? "Player"}</span>
                <span className="hd-meta">{labelOf(lot.role)}</span>
              </span>
              <span className="hd-figure">{money.ledger(lot.soldPrice ?? 0)}</span>
            </li>
          ))}
        </ol>
        <p className="hd-foot">
          <strong>{money.ledger(average)}</strong> an average buy across {String(bought.length)}{" "}
          {bought.length === 1 ? "player" : "players"}.
        </p>
      </section>
      {season !== null ? (
        <OurMatches teamId={teamId} season={season} href={fixturesHref} today={today} />
      ) : balance.length > 0 ? (
        <section className="hd-card" aria-labelledby={`hd-bal-${teamId}`}>
          <div className="hd-head">
            <h2 id={`hd-bal-${teamId}`} className="hd-title">
              <IconChart size={20} />
              Squad balance
            </h2>
          </div>
          <ul className="hd-bars">
            {balance.map((row) => (
              <li key={row.key}>
                <span className="hd-bar-line">
                  <span>{row.label}</span>
                  <span>{String(row.count)}</span>
                </span>
                <span className="hd-bar" aria-hidden>
                  <i style={{ transform: `scaleX(${String(row.count / most)})` }} />
                </span>
              </li>
            ))}
          </ul>
          {heaviestRole !== null && heaviestShare > 0 ? (
            <p className="hd-foot">
              <strong>{String(heaviestShare)}%</strong> of the spend went on{" "}
              {labelOf(heaviestRole).toLowerCase()}s — {money.ledger(heaviestSpend)}.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** "1st", "2nd", "3rd", "11th". */
function ordinal(n: number): string {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${String(n)}${suffix}`;
}

function tomorrowOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** "Today", "Tomorrow" or "Mon, 29 Sep", then the time. */
function whenLabel(kickoffAt: string | null, today: string): string {
  if (kickoffAt === null) return "Date to be announced";
  const day = kickoffAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return kickoffAt;
  const time =
    kickoffAt.length > 10 ? formatWallTime(kickoffAt.replace(" ", "T").slice(0, 16)) : null;
  const date =
    day === today ? "Today" : day === tomorrowOf(today) ? "Tomorrow" : formatDayDate(day);
  return time === null ? date : `${date} · ${time}`;
}

/** The next match, as a strip inside the team hero. */
function NextStrip({ season, today }: { season: TeamSeason; today: string }) {
  const next = season.upcoming[0];
  if (next === undefined) {
    return (
      <p className="ow-next" data-testid="home-owner-next">
        <span className="ow-next-when">No more matches published</span>
        <span className="ow-next-meta">The club adds them on the schedule.</span>
      </p>
    );
  }
  const rest = season.upcoming.length - 1;
  return (
    <p className="ow-next" data-testid="home-owner-next">
      <span className="ow-next-when">
        {next.live ? "Live now" : `Next · ${whenLabel(next.kickoffAt, today)}`}
      </span>
      <span className="ow-next-vs">
        <span className="ow-next-word">vs</span>
        <i style={{ background: next.opponentColor ?? "currentColor" }} aria-hidden />
        {next.opponentName}
      </span>
      <span className="ow-next-meta">
        {[
          next.groundName,
          next.live ? null : lineupWords(next.lineup),
          rest > 0 ? `${String(rest)} more to come` : null,
          season.awaiting.length > 0 ? `${String(season.awaiting.length)} awaiting a result` : null,
        ]
          .filter((part): part is string => part !== null && part !== "")
          .join(" · ")}
      </span>
    </p>
  );
}

const RESULT_WORD = { won: "Won", lost: "Lost", tied: "Tied", no_result: "No result" } as const;

/** Next matches, then results — the team's season in rows. */
function OurMatches({
  teamId,
  season,
  href,
  today,
}: {
  teamId: string;
  season: TeamSeason;
  href: string;
  today: string;
}) {
  // Past matches with no result come first: they are the ones someone owes
  // a score for, and they used to vanish from this card.
  const due = season.awaiting.slice(0, 2);
  const next = season.upcoming.slice(0, 2);
  const done = season.results.slice(0, next.length + due.length > 0 ? 2 : 4);
  const row = (match: TeamSeasonMatch, upcoming: boolean, overdue = false) => {
    const day = match.kickoffAt?.slice(0, 10) ?? null;
    const tile = day !== null && /^\d{4}-\d{2}-\d{2}$/.test(day) ? dateTile(day) : null;
    return (
      <li key={match.fixtureId} className="ow-match">
        <span className="ow-match-when">
          {day === today ? "Today" : tile === null ? "TBA" : `${tile.day} ${tile.month}`}
        </span>
        <span className="hd-who">
          <span className="hd-name">vs {match.opponentName}</span>
          <span className="hd-meta">
            {upcoming
              ? [whenLabel(match.kickoffAt, today).split(" · ")[1] ?? null, match.groundName]
                  .filter((part): part is string => part !== null && part !== "")
                  .join(" · ") || "Time to be announced"
              : (match.groundName ?? "Played")}
          </span>
        </span>
        {overdue ? (
          <span className="ow-match-next" data-state="due">
            Result due
          </span>
        ) : upcoming || match.result === null ? (
          <span className="ow-match-next">{match.live ? "Live" : "Next"}</span>
        ) : (
          <span className="ow-result" data-result={match.result}>
            <span aria-hidden>
              {match.result === "won"
                ? "W"
                : match.result === "lost"
                  ? "L"
                  : match.result === "tied"
                    ? "T"
                    : "–"}
            </span>
            <VisuallyHidden>{RESULT_WORD[match.result]}</VisuallyHidden>
          </span>
        )}
      </li>
    );
  };
  return (
    <section
      className="hd-card"
      aria-labelledby={`hd-matches-${teamId}`}
      data-testid="home-owner-matches"
    >
      <div className="hd-head">
        <h2 id={`hd-matches-${teamId}`} className="hd-title">
          <IconCalendar size={20} />
          Our matches
          {season.record.played > 0 ? (
            <span className="hd-title-sub">
              · {season.record.played} played · {season.record.won} won
            </span>
          ) : null}
        </h2>
        <Link className="hd-link" href={href}>
          Schedule
          <IconArrowRight size={16} />
        </Link>
      </div>
      <ol className="ow-matches">
        {next.map((match) => row(match, true))}
        {due.map((match) => row(match, false, true))}
        {done.map((match) => row(match, false))}
      </ol>
    </section>
  );
}
