import {
  ButtonLink,
  EmptyState,
  IconArrowRight,
  IconChart,
  IconCheckCircle,
  IconDownload,
  IconLock,
  Notice,
  Pill,
  PlayerImage,
  Toolbar,
  ToolbarSpacer,
  VisuallyHidden,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { exactINR } from "../../lib/inr";
import { cardAmount, moneyFormat } from "../../lib/money";
import type { ReportTable } from "../../server/console/reports";
import { reportsView } from "../../server/console/views";
import { ChapterBody } from "./chapter-body";
import { SeasonPicker } from "./season-picker";
import { NavButton } from "../players/nav-button";
import "../players/players.css";
import "./reports.css";
import { formatCount } from "../../lib/plural";
import { formatDate } from "../../lib/format-date";
import { auctionStage, registrationStage, resultSentence, seasonStage } from "./reports-model";

export const metadata = { title: "Reports" };

function count(value: number): string {
  return formatCount(value);
}

function pctOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** One labelled bar. The value is always printed — the bar only illustrates it. */
interface Bar {
  key: string;
  label: ReactNode;
  value: string;
  /** 0–1 of the longest bar. */
  share: number;
  tone?: KitTone;
  /** A team's own colour, when the bar stands for a team. */
  color?: string | null;
  note?: string;
}

function Bars({ bars, label, testId }: { bars: readonly Bar[]; label: string; testId: string }) {
  return (
    <ul className="rp-bars" aria-label={label} data-testid={testId}>
      {bars.map((bar) => (
        <li key={bar.key} className="rp-bar-row">
          <span className="rp-bar-label">{bar.label}</span>
          <span
            className="rp-bar-track"
            aria-hidden
            data-tone={bar.tone}
            style={
              bar.color !== undefined && bar.color !== null
                ? ({ "--rp-fill": bar.color } as CSSProperties)
                : undefined
            }
          >
            <span
              className="rp-bar-fill"
              style={{ transform: `scaleX(${String(Math.max(0, Math.min(1, bar.share)))})` }}
            />
          </span>
          <span className="rp-bar-value">
            {bar.value}
            {bar.note !== undefined ? <span className="rp-bar-note"> {bar.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CsvLink({
  slug,
  table,
  label,
  text = "CSV",
}: {
  slug: string;
  table: ReportTable;
  label: string;
  /** The words on the button — say which file when a card offers two. */
  text?: string;
}) {
  return (
    <ButtonLink
      href={`/reports/export?season=${encodeURIComponent(slug)}&table=${table}`}
      variant="ghost"
      size="sm"
      download
      aria-label={`Download ${label} as CSV`}
    >
      <IconDownload size={16} aria-hidden /> {text}
    </ButtonLink>
  );
}

/**
 * /reports — one season at a time, for the people who review it.
 *
 * Every rupee on this page is absent (not zero, not hidden) unless the viewer
 * holds the season's books — `competition.manage` or `settlement.view`; see
 * `server/console/reports.ts`. Staff who only review registrations still get
 * the head counts.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = typeof params["season"] === "string" ? params["season"] : undefined;
  const view = await reportsView(requested);

  if (view.season === null || view.report === null) {
    return (
      <main className="px-players">
        <section className="px-empty" data-testid="reports-empty">
          <EmptyState
            icon={<IconChart />}
            title="No reports yet"
            headingLevel={2}
            description={
              <>
                Reports summarise the seasons you run — registrations, fees and auction spend. Once
                you review registrations for a season, its report appears here.
              </>
            }
            action={
              <>
                <NavButton href="/tournaments" variant="primary" size="touch">
                  Go to tournaments
                </NavButton>
              </>
            }
          />
        </section>
      </main>
    );
  }

  const { season, report, money } = view;
  const regs = report.registrations;

  const fees = report.fees;
  const feeHeads = fees.paid + fees.pending + fees.waived + fees.refunded;
  /*
   * A season with no fee on record — nobody paid, waived or refunded, and no
   * amount is written anywhere — has no fees to report. It used to read "₹0
   * collected · ₹0 still due" over a bar of 43 "Not paid", which is the report
   * inventing a debt the league never levied.
   */
  const feesInUse =
    fees.paid + fees.waived + fees.refunded > 0 ||
    (fees.collectedPaise ?? 0) > 0 ||
    (fees.duePaise ?? 0) > 0;
  const feeRows: [string, string, number, KitTone][] = [
    ["paid", "Paid", fees.paid, "green"],
    ["pending", "Not paid", fees.pending, "amber"],
    ["waived", "Waived", fees.waived, "blue"],
    ["refunded", "Refunded", fees.refunded, "neutral"],
  ];
  const feeBars: Bar[] = feeRows.map(([key, label, value, tone]) => ({
    key,
    label,
    value: count(value),
    share: feeHeads > 0 ? value / feeHeads : 0,
    tone,
  }));
  const auction = report.auction;
  // Auction figures count in the season's unit (0091); fees stay rupees.
  const unitMoney = moneyFormat(report.auctionUnit);
  const lotsDone = auction.sold + auction.unsold;
  const lotsAll = lotsDone + auction.remaining;
  const spendMax = Math.max(...report.teams.map((team) => team.spend ?? 0), 1);
  const squadMax = Math.max(
    ...report.teams.map((team) => Math.max(team.squad, team.squadMax ?? 0)),
    1,
  );
  const play = view.play;
  const matchesAll = play === null ? 0 : play.played + play.live + play.toCome + play.awaiting;

  const stages = [
    {
      ...registrationStage(season.status, regs.total),
      figure: count(regs.total),
      detail: regs.total === 1 ? "registered" : "registered",
    },
    {
      ...auctionStage(auction.status, auction.sold, auction.unsold, auction.remaining),
      figure: auction.status === null ? "—" : `${count(auction.sold)} of ${count(lotsAll)}`,
      detail:
        auction.status === null
          ? "no auction yet"
          : auction.moneyMoved !== undefined
            ? `sold · ${cardAmount(report.auctionUnit, auction.moneyMoved)}`
            : "sold",
    },
    ...(play === null
      ? []
      : [
          {
            ...seasonStage(play),
            figure: matchesAll === 0 ? "—" : `${count(play.played)} of ${count(matchesAll)}`,
            detail: matchesAll === 0 ? "no fixtures yet" : "matches played",
          },
        ]),
  ];
  const stateOf = (key: string) => stages.find((stage) => stage.key === key);
  // While a stage is under way, the finished ones fold on a phone.
  const underWay = stages.some((stage) => stage.tone === "now");
  const foldable = (key: string) => underWay && stateOf(key)?.tone === "done";
  const avgSale =
    auction.moneyMoved !== undefined && auction.sold > 0
      ? Math.round(auction.moneyMoved / auction.sold)
      : null;
  const leader = play?.table?.[0];

  return (
    <main className="px-players rp-page">
      {/* ONE ROW: which season, and the switch to another. */}
      <Toolbar className="rp-toolbar">
        {view.seasons.length > 1 ? (
          <SeasonPicker current={season.slug} seasons={view.seasons} />
        ) : (
          <p className="rp-scope">
            <span className="rp-scope-name">{season.name}</span>
            <span className="rp-scope-org">· {season.orgName}</span>
          </p>
        )}
        <ToolbarSpacer />
        <Link href={`/seasons/${season.slug}`} className="rp-open">
          Open the season
          <IconArrowRight size={16} aria-hidden />
        </Link>
      </Toolbar>

      {!money ? (
        <Notice
          tone="info"
          icon={<IconLock />}
          title="Money figures are hidden"
          testId="reports-no-money"
        >
          Fees collected, auction spend and purses are shown to the club&rsquo;s owners and its
          finance desk.
        </Notice>
      ) : null}

      {/* THE JOURNEY — where the season stands, stage by stage; each stage
          is the door to its chapter below. */}
      <nav className="rp-journey" aria-label="Season stages" data-testid="reports-stats">
        {stages.map((stage, index) => (
          <a key={stage.key} href={`#rp-${stage.key}`} className="rp-stage" data-tone={stage.tone}>
            <span className="rp-stage-top">
              <span className="rp-stage-n">{index + 1}</span>
              <span className="rp-stage-title">{stage.title}</span>
              <span className="rp-stage-state">{stage.state}</span>
            </span>
            <span className="rp-stage-fig">
              <b>{stage.figure}</b> {stage.detail}
            </span>
            <span className="rp-stage-bar" aria-hidden>
              <i style={{ transform: `scaleX(${String(stage.pct / 100)})` }} />
            </span>
          </a>
        ))}
      </nav>

      <Chapter
        id="rp-registration"
        n={1}
        title="Registration"
        stage={stateOf("registration")}
        foldable={foldable("registration")}
        summary={`${count(regs.total)} registered · ${count(regs.auctionPool)} in the pool · ${count(regs.preSigned)} pre-signed${regs.submitted > 0 ? ` · ${count(regs.submitted)} to review` : ""}`}
        actions={
          <>
            <CsvLink slug={season.slug} table="registrations" label="registrations" />
            <Link href={`/seasons/${season.slug}/registrations`} className="rp-door">
              Players <IconArrowRight size={14} aria-hidden />
            </Link>
          </>
        }
        testId="report-registrations"
        left={
          <>
            <h3 className="rp-sub">
              Where the players are
              <span>
                {regs.total === regs.approved && regs.total > 0
                  ? `all ${count(regs.total)} approved`
                  : `${count(regs.approved)} of ${count(regs.total)} approved`}
              </span>
            </h3>
            <Split
              label="Players by where they are"
              parts={[
                {
                  key: "pool",
                  value: regs.auctionPool,
                  label: "in the auction pool",
                  tone: "gold",
                },
                {
                  key: "signed",
                  value: regs.preSigned,
                  label: "pre-signed — captains & icons",
                  tone: "purple",
                },
                { key: "review", value: regs.submitted, label: "waiting for review", tone: "blue" },
                { key: "waitlist", value: regs.waitlisted, label: "waitlisted", tone: "amber" },
              ]}
              testId="report-status-bars"
            />
            {regs.rejected + regs.withdrawn > 0 ? (
              <p className="rp-zero">
                {count(regs.rejected)} declined · {count(regs.withdrawn)} withdrawn
              </p>
            ) : (
              <p className="rp-zero">Nobody declined or withdrawn.</p>
            )}
          </>
        }
        right={
          <div data-testid="report-fees" className="rp-col">
            <h3 className="rp-sub">
              Fees
              {feesInUse && fees.collectedPaise !== undefined && fees.duePaise !== undefined ? (
                <span>
                  {/* rupees-always: registration fees are real money in every season */}
                  {exactINR(fees.collectedPaise)} collected · {exactINR(fees.duePaise)} still due
                </span>
              ) : null}
            </h3>
            {feesInUse ? (
              <Bars label="Fees by state" testId="report-fee-bars" bars={feeBars} />
            ) : (
              <>
                <p className="rp-lead">No fee was set for this season.</p>
                <p className="rp-quiet">
                  Registration was free, so there is nothing to collect. Set a fee on the season and
                  who has paid shows here.
                </p>
              </>
            )}
          </div>
        }
      />

      <Chapter
        id="rp-auction"
        n={2}
        title="Auction"
        stage={stateOf("auction")}
        foldable={foldable("auction")}
        summary={
          auction.status === null
            ? "No auction yet — the purse and rules create it."
            : [
                `${count(auction.sold)} of ${count(lotsAll)} sold`,
                auction.moneyMoved !== undefined
                  ? `${cardAmount(report.auctionUnit, auction.moneyMoved)} spent`
                  : null,
                auction.pursePct !== undefined && auction.pursePct !== null
                  ? `${String(auction.pursePct)}% of all purses`
                  : null,
              ]
                .filter((part): part is string => part !== null)
                .join(" · ")
        }
        actions={
          <>
            {money && report.teams.length > 0 ? (
              <CsvLink slug={season.slug} table="teams" label="team spend" text="Team spend" />
            ) : null}
            {money && (report.topBuys ?? []).length > 0 ? (
              <CsvLink slug={season.slug} table="buys" label="top buys" text="Top buys" />
            ) : null}
            <Link href={`/seasons/${season.slug}/auction`} className="rp-door">
              {auction.status === null ? "Auction setup" : "Results & replay"}{" "}
              <IconArrowRight size={14} aria-hidden />
            </Link>
          </>
        }
        testId="report-lots"
        left={
          auction.status === null ? (
            <>
              <h3 className="rp-sub">How the pool went</h3>
              <p className="rp-quiet">
                Nothing yet. Once the purse and rules are set and the auction runs, how the pool
                went and what each team spent show here.
                {report.teams.length > 0
                  ? ` ${count(report.teams.length)} teams are ready to bid.`
                  : ""}
              </p>
            </>
          ) : (
            <>
              <h3 className="rp-sub">
                How the pool went
                <span>
                  {count(lotsAll)} lots
                  {avgSale !== null ? ` · avg ${unitMoney.compact(avgSale)} a sale` : ""}
                </span>
              </h3>
              <Split
                label="Lots by outcome"
                parts={[
                  { key: "sold", value: auction.sold, label: "sold", tone: "green" },
                  { key: "unsold", value: auction.unsold, label: "unsold", tone: "neutral" },
                  {
                    key: "remaining",
                    value: auction.remaining,
                    label: "still to go",
                    tone: "gold",
                  },
                ]}
                testId="report-lot-bars"
              />
              <div className="rp-rule" />
              <div data-testid="report-teams" className="rp-col">
                <h3 className="rp-sub">
                  {money ? "Purse used" : "Squads"}
                  <span>
                    {report.teams.length === 0
                      ? "no teams yet"
                      : money && report.teams[0]?.purse !== undefined
                        ? `of ${unitMoney.exact(report.teams[0].purse)} each`
                        : "players signed to each team"}
                  </span>
                </h3>
                {report.teams.length === 0 ? null : (
                  <Bars
                    label={money ? "Spend by team" : "Squad size by team"}
                    testId="report-team-bars"
                    bars={report.teams.map((team) =>
                      team.spend !== undefined
                        ? {
                            key: team.teamId,
                            label: team.name,
                            value: cardAmount(report.auctionUnit, team.spend),
                            share:
                              team.purse !== undefined && team.purse > 0
                                ? Math.min(1, team.spend / team.purse)
                                : team.spend / spendMax,
                            color: team.color,
                            ...(team.purse !== undefined
                              ? { note: `${String(pctOf(team.spend, team.purse))}%` }
                              : {}),
                          }
                        : {
                            key: team.teamId,
                            label: team.name,
                            value: `${count(team.squad)} players`,
                            share: team.squad / squadMax,
                            color: team.color,
                          },
                    )}
                  />
                )}
              </div>
            </>
          )
        }
        right={
          money && auction.status !== null ? (
            <div data-testid="report-top-buys" className="rp-col">
              <h3 className="rp-sub">Top buys</h3>
              {(report.topBuys ?? []).length === 0 ? (
                <p className="rp-quiet">Nobody has been sold yet.</p>
              ) : (
                <ol className="rp-buys">
                  {(report.topBuys ?? []).map((buy, index) => (
                    <li key={buy.registrationId} className="rp-buy">
                      <span className="rp-rank">{index + 1}</span>
                      <PlayerImage
                        name={buy.playerName ?? "Player"}
                        seed={buy.registrationId}
                        src={buy.photoUrl}
                        size="sm"
                        shape="round"
                        decorative
                      />
                      <span className="rp-buy-text">
                        <span className="rp-buy-name">{buy.playerName ?? "Unnamed player"}</span>
                        <span className="rp-buy-sub">
                          {[buy.role, buy.teamName].filter((part) => part !== null).join(" · ")}
                        </span>
                      </span>
                      <span className="rp-buy-price">
                        {cardAmount(report.auctionUnit, buy.price)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null
        }
      />

      {play !== null ? (
        <Chapter
          id="rp-season"
          n={3}
          title="Season"
          stage={stateOf("season")}
          foldable={foldable("season")}
          summary={
            matchesAll === 0
              ? "No fixtures published yet."
              : [
                  `${count(play.played)} of ${count(matchesAll)} matches played`,
                  play.live > 0 ? `${count(play.live)} live` : null,
                  play.awaiting > 0 ? `${count(play.awaiting)} awaiting a result` : null,
                  leader !== undefined && leader.played > 0
                    ? `${leader.name} lead on ${count(leader.points)} pts`
                    : null,
                ]
                  .filter((part): part is string => part !== null)
                  .join(" · ")
          }
          actions={
            <>
              <Link href={`/seasons/${season.slug}/fixtures`} className="rp-door">
                Schedule <IconArrowRight size={14} aria-hidden />
              </Link>
              {play.table !== null ? (
                <Link href={`/seasons/${season.slug}/standings`} className="rp-door">
                  Table <IconArrowRight size={14} aria-hidden />
                </Link>
              ) : null}
            </>
          }
          testId="report-season"
          left={
            play.table === null || play.played === 0 ? (
              play.table !== null ? (
                <>
                  <h3 className="rp-sub">The table</h3>
                  <p className="rp-quiet">
                    It fills in after the first result — {count(play.table.length)} teams, all level
                    on 0.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="rp-sub">The standings</h3>
                  <p className="rp-quiet">
                    This season places squads match by match — the full standings are on the Table
                    tab.
                  </p>
                </>
              )
            ) : (
              <>
                <h3 className="rp-sub">
                  The table
                  <span>
                    {play.played === 0
                      ? "before the first result"
                      : `after ${count(play.played)} of ${count(matchesAll)} matches`}
                  </span>
                </h3>
                <table className="rp-table" data-testid="report-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        <VisuallyHidden>Position</VisuallyHidden>
                      </th>
                      <th scope="col">
                        <VisuallyHidden>Team</VisuallyHidden>
                      </th>
                      <th scope="col">
                        <abbr title="Played">P</abbr>
                      </th>
                      <th scope="col">
                        <abbr title="Won">W</abbr>
                      </th>
                      <th scope="col">
                        <abbr title="Lost">L</abbr>
                      </th>
                      <th scope="col">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {play.table.map((row, index) => (
                      <tr key={row.teamId}>
                        <td className="rp-table-pos">{index + 1}</td>
                        <th scope="row">
                          <span
                            className="rp-dot"
                            style={
                              row.color === null
                                ? undefined
                                : ({ "--rp-fill": row.color } as CSSProperties)
                            }
                            aria-hidden
                          />
                          {row.name}
                        </th>
                        <td>{row.played}</td>
                        <td>{row.won}</td>
                        <td>{row.lost}</td>
                        <td className="rp-table-pts">{row.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )
          }
          right={
            <>
              <h3 className="rp-sub">
                Matches
                {matchesAll > 0 ? (
                  <span>
                    {[
                      `${count(play.played)} played`,
                      play.live > 0 ? `${count(play.live)} live` : null,
                      play.awaiting > 0 ? `${count(play.awaiting)} awaiting a result` : null,
                      `${count(play.toCome)} to come`,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(" · ")}
                  </span>
                ) : null}
              </h3>
              {matchesAll === 0 ? (
                <p className="rp-quiet">Matches show up here once the schedule is published.</p>
              ) : (
                <>
                  <Split
                    label="Matches by state"
                    parts={[
                      { key: "played", value: play.played, label: "played", tone: "green" },
                      { key: "live", value: play.live, label: "live", tone: "gold" },
                      {
                        key: "due",
                        value: play.awaiting,
                        label: "awaiting a result",
                        tone: "amber",
                      },
                      { key: "next", value: play.toCome, label: "to come", tone: "neutral" },
                    ]}
                    legend={false}
                    testId="report-match-bars"
                  />
                  <ul className="rp-matches">
                    {play.liveMatches.map((match) => (
                      <li key={match.fixtureId} data-live="">
                        <span className="rp-match-when">Live</span>
                        <span>{resultSentence(match).rest}</span>
                      </li>
                    ))}
                    {/* Owed a result: listed, as the count above says (census 12). */}
                    {play.awaitingMatches.map((match) => (
                      <li key={match.fixtureId} data-due="">
                        <span className="rp-match-when">
                          {match.kickoffAt === null ? "—" : shortDate(match.kickoffAt)}
                        </span>
                        <span>
                          {match.homeName ?? "Lobby"}
                          {match.awayName !== null ? ` v ${match.awayName}` : ""}
                        </span>
                        <Pill tone="amber">Result due</Pill>
                      </li>
                    ))}
                    {play.recent.map((match) => {
                      const said = resultSentence(match);
                      return (
                        <li key={match.fixtureId}>
                          <span className="rp-match-when">
                            {match.kickoffAt === null ? "—" : shortDate(match.kickoffAt)}
                          </span>
                          <span>
                            {said.lead !== null ? <strong>{said.lead}</strong> : null}
                            {said.rest}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          }
        />
      ) : null}

      <p className="rp-foot">
        <IconCheckCircle size={16} aria-hidden /> Live — the same numbers the season&rsquo;s
        Players, Teams, Auction and Schedule tabs show.
      </p>
    </main>
  );
}

/** "26 Sep" from a wall-clock kickoff. */
function shortDate(kickoffAt: string): string {
  const day = kickoffAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDate(day).replace(/ \d{4}$/, "") : day;
}

/** One stage of the season as a card: its header, then one or two columns. */
function Chapter({
  id,
  n,
  title,
  stage,
  summary,
  actions,
  left,
  right,
  testId,
  foldable = false,
}: {
  id: string;
  n: number;
  title: string;
  stage: { state: string; tone: string } | undefined;
  summary: string;
  actions: ReactNode;
  left: ReactNode;
  right: ReactNode;
  testId: string;
  /** A finished stage while another is under way — folded on a phone. */
  foldable?: boolean;
}) {
  return (
    <section id={id} className="rp-chapter" aria-labelledby={`${id}-title`} data-testid={testId}>
      <header className="rp-chapter-head">
        <span className="rp-chapter-n" data-tone={stage?.tone} aria-hidden>
          {n}
        </span>
        <span className="rp-chapter-id">
          <span className="rp-chapter-line">
            <h2 id={`${id}-title`}>{title}</h2>
            {stage !== undefined ? (
              <span className="rp-chapter-state" data-tone={stage.tone}>
                {stage.state}
              </span>
            ) : null}
          </span>
          <span className="rp-chapter-summary">{summary}</span>
        </span>
        <span className="rp-chapter-actions">{actions}</span>
      </header>
      <ChapterBody foldable={foldable} title={title} single={right === null}>
        <div className="rp-col">{left}</div>
        {right === null ? null : <div className="rp-col">{right}</div>}
      </ChapterBody>
    </section>
  );
}

interface SplitPart {
  key: string;
  value: number;
  label: string;
  tone: "gold" | "green" | "neutral" | "purple" | "blue" | "amber";
}

/** One bar split by share, and its legend; empty parts drop out of both. */
function Split({
  parts,
  label,
  testId,
  legend = true,
}: {
  parts: readonly SplitPart[];
  label: string;
  testId: string;
  legend?: boolean;
}) {
  const shown = parts.filter((part) => part.value > 0);
  return (
    <div className="rp-split" data-testid={testId}>
      <span className="rp-split-bar" aria-hidden>
        {shown.map((part) => (
          <i key={part.key} data-tone={part.tone} style={{ flexGrow: part.value }} />
        ))}
      </span>
      {legend ? (
        <ul className="rp-legend" aria-label={label}>
          {shown.map((part) => (
            <li key={part.key} data-tone={part.tone}>
              <b>{count(part.value)}</b> {part.label}
            </li>
          ))}
        </ul>
      ) : (
        <VisuallyHidden>
          {shown.map((part) => `${count(part.value)} ${part.label}`).join(", ")}
        </VisuallyHidden>
      )}
    </div>
  );
}
