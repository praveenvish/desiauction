import {
  ButtonLink,
  CardGrid,
  EmptyState,
  IconArrowRight,
  IconChart,
  IconCheckCircle,
  IconDownload,
  IconGavel,
  IconLock,
  IconReceipt,
  IconStar,
  IconUsers,
  IconWallet,
  type KitTone,
  Notice,
  PlayerImage,
  SectionCard,
  StatCard,
  StatGrid,
  Toolbar,
  ToolbarSpacer,
} from "@desiauction/ui";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { compactINR, exactINR } from "../../lib/inr";
import { cardAmount, moneyFormat } from "../../lib/money";
import type { ReportTable } from "../../server/console/reports";
import { reportsView } from "../../server/console/views";
import { SeasonPicker } from "./season-picker";
import { NavButton } from "../players/nav-button";
import "../players/players.css";
import "./reports.css";

export const metadata = { title: "Reports · DesiAuction" };

function count(value: number): string {
  return value.toLocaleString("en-IN");
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

function CsvLink({ slug, table, label }: { slug: string; table: ReportTable; label: string }) {
  return (
    <ButtonLink
      href={`/reports/export?season=${encodeURIComponent(slug)}&table=${table}`}
      variant="ghost"
      size="sm"
      download
      aria-label={`Download ${label} as CSV`}
    >
      <IconDownload size={16} aria-hidden /> CSV
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
  const statusRows: [string, string, number, KitTone][] = [
    ["submitted", "Submitted", regs.submitted, "blue"],
    ["approved", "Approved", regs.approved, "green"],
    ["waitlisted", "Waitlisted", regs.waitlisted, "amber"],
    ["rejected", "Declined", regs.rejected, "red"],
    ["withdrawn", "Withdrawn", regs.withdrawn, "neutral"],
  ];
  const statusMax = Math.max(...statusRows.map((row) => row[2]), 1);
  /** Statuses nobody is in: one quiet line, not four empty bars. */
  const zeroStatuses = statusRows.filter((row) => row[2] === 0).map((row) => row[1].toLowerCase());
  const statusBars: Bar[] = statusRows.map(([key, label, value, tone]) => ({
    key,
    label,
    value: count(value),
    share: value / statusMax,
    tone,
  }));

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

  return (
    <main className="px-players">
      {/* ONE ROW: which season, and the switch to another. The title band
          above the tiles (~70px) was the season's name in a heading. */}
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

      <StatGrid testId="reports-stats">
        <StatCard
          icon={<IconUsers />}
          tone="gold"
          value={count(regs.total)}
          label="Registrations"
          hint={`${count(regs.approved)} approved · ${count(regs.submitted)} to review`}
        />
        {feesInUse ? (
          <StatCard
            icon={<IconReceipt />}
            tone="gold"
            value={
              // rupees-always: registration fees are real money in every season
              fees.collectedPaise !== undefined ? compactINR(fees.collectedPaise) : count(fees.paid)
            }
            label={fees.collectedPaise !== undefined ? "Fees collected" : "Fees paid"}
            hint={`${count(fees.paid)} of ${count(feeHeads)} players paid`}
            progress={pctOf(fees.paid, feeHeads)}
          />
        ) : null}
        <StatCard
          icon={<IconGavel />}
          tone="gold"
          value={`${count(auction.sold)} / ${count(lotsAll)}`}
          label="Lots sold"
          hint={auction.status === null ? "No auction yet" : `${count(auction.unsold)} unsold`}
          progress={pctOf(auction.sold, lotsAll)}
        />
        <StatCard
          icon={<IconWallet />}
          tone="gold"
          value={
            auction.moneyMoved !== undefined
              ? cardAmount(report.auctionUnit, auction.moneyMoved)
              : "—"
          }
          label="Auction spend"
          hint={
            auction.pursePct !== undefined && auction.pursePct !== null
              ? `${String(auction.pursePct)}% of all purses`
              : money
                ? "No purse set yet"
                : "Owners and finance only"
          }
          {...(auction.pursePct !== undefined && auction.pursePct !== null
            ? { progress: auction.pursePct }
            : {})}
        />
      </StatGrid>

      {/* Rebalanced (wow pass): no Fees card when no fee was ever recorded,
          spend and purse are ONE card (they charted the same bars twice), and
          every row is a pair, so the masonry leaves no hole. */}
      <CardGrid>
        <SectionCard
          icon={<IconUsers />}
          title="Registrations by status"
          description={`${count(regs.total)} in total · ${count(regs.auctionPool)} in the auction pool · ${count(regs.preSigned)} pre-signed`}
          action={<CsvLink slug={season.slug} table="registrations" label="registrations" />}
          data-testid="report-registrations"
        >
          <Bars
            bars={statusBars.filter((bar) => bar.value !== "0")}
            label="Registrations by status"
            testId="report-status-bars"
          />
          {zeroStatuses.length > 0 ? (
            <p className="rp-zero">{zeroStatuses.map((label) => `0 ${label}`).join(" · ")}</p>
          ) : null}
        </SectionCard>

        {feesInUse ? (
          <SectionCard
            icon={<IconReceipt />}
            title="Fees"
            description={
              fees.collectedPaise !== undefined && fees.duePaise !== undefined
                ? // rupees-always: registration fees are real money in every season
                  `${exactINR(fees.collectedPaise)} collected · ${exactINR(fees.duePaise)} still due`
                : "Who has paid, by head count"
            }
            data-testid="report-fees"
          >
            <Bars label="Fees by state" testId="report-fee-bars" bars={feeBars} />
          </SectionCard>
        ) : (
          <SectionCard
            icon={<IconGavel />}
            title="Sold and unsold"
            description="How the auction pool went"
            data-testid="report-lots"
          >
            <LotBars sold={auction.sold} unsold={auction.unsold} remaining={auction.remaining} />
          </SectionCard>
        )}
      </CardGrid>

      <CardGrid>
        <SectionCard
          icon={<IconWallet />}
          title={money ? "Purse by team" : "Squads by team"}
          description={
            report.teams.length === 0
              ? "No teams yet"
              : money
                ? report.teams[0]?.purse !== undefined
                  ? `What each team spent of its ${unitMoney.exact(report.teams[0].purse)} purse`
                  : "What each team spent at the auction"
                : "Players signed to each team"
          }
          {...(money && report.teams.length > 0
            ? { action: <CsvLink slug={season.slug} table="teams" label="team spend" /> }
            : {})}
          data-testid="report-teams"
        >
          {report.teams.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<IconUsers />}
              title="Teams appear here once they are created"
            />
          ) : (
            <Bars
              label={money ? "Spend by team" : "Squad size by team"}
              testId="report-team-bars"
              bars={report.teams.map((team) =>
                team.spend !== undefined
                  ? {
                      key: team.teamId,
                      label: team.name,
                      value: cardAmount(report.auctionUnit, team.spend),
                      // Against the PURSE when there is one, so the bar is how
                      // much of it went — the old second card's whole job.
                      share:
                        team.purse !== undefined && team.purse > 0
                          ? Math.min(1, team.spend / team.purse)
                          : team.spend / spendMax,
                      color: team.color,
                      note:
                        team.purse !== undefined
                          ? `· ${String(pctOf(team.spend, team.purse))}% · ${unitMoney.compactFloor(Math.max(0, team.purse - team.spend))} left · ${count(team.squad)} players`
                          : `· ${count(team.squad)} players`,
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
        </SectionCard>

        {money ? (
          <SectionCard
            icon={<IconStar />}
            title="Top buys"
            description="The five dearest players of the night"
            {...((report.topBuys ?? []).length > 0
              ? { action: <CsvLink slug={season.slug} table="buys" label="top buys" /> }
              : {})}
            data-testid="report-top-buys"
          >
            {(report.topBuys ?? []).length === 0 ? (
              <EmptyState size="compact" icon={<IconGavel />} title="Nobody has been sold yet" />
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
          </SectionCard>
        ) : feesInUse ? (
          <SectionCard
            icon={<IconGavel />}
            title="Sold and unsold"
            description="How the auction pool went"
            data-testid="report-lots"
          >
            <LotBars sold={auction.sold} unsold={auction.unsold} remaining={auction.remaining} />
          </SectionCard>
        ) : null}
      </CardGrid>

      {money && feesInUse ? (
        <SectionCard
          icon={<IconGavel />}
          title="Sold and unsold"
          description="How the auction pool went"
          data-testid="report-lots"
        >
          <LotBars sold={auction.sold} unsold={auction.unsold} remaining={auction.remaining} />
        </SectionCard>
      ) : null}

      <p className="rp-foot">
        <IconCheckCircle size={16} aria-hidden /> Figures are read live from the season&rsquo;s own
        desks — the same numbers its Registrations, Teams and Auction tabs show.
      </p>
    </main>
  );
}

function LotBars({ sold, unsold, remaining }: { sold: number; unsold: number; remaining: number }) {
  const all = Math.max(sold + unsold + remaining, 1);
  return (
    <Bars
      label="Lots by outcome"
      testId="report-lot-bars"
      bars={[
        { key: "sold", label: "Sold", value: count(sold), share: sold / all, tone: "green" },
        {
          key: "unsold",
          label: "Unsold",
          value: count(unsold),
          share: unsold / all,
          tone: "amber",
        },
        // "Still to go 0" after the night is a bar about nothing.
        ...(remaining > 0
          ? [
              {
                key: "remaining",
                label: "Still to go",
                value: count(remaining),
                share: remaining / all,
                tone: "neutral" as const,
              },
            ]
          : []),
      ]}
    />
  );
}
