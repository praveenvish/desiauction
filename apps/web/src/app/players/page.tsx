import {
  EmptyState,
  IconGlobe,
  IconStar,
  IconUsers,
  type KitTone,
  Pager,
  Pill,
  PlayerImage,
  SegmentedTabs,
  TeamChip,
} from "@desiauction/ui";
import Link from "next/link";

import { playersIndexView } from "../../server/console/views";
import { PLAYERS_PAGE_SIZE, type PlayerIndexRow } from "../../server/console/players-index";
import { FEE_LABEL, STATUS_LABEL } from "../seasons/[slug]/_players/labels";
import { NavButton } from "./nav-button";
import { PlayersFilters } from "./players-filters";
import "./players.css";
import { formatCount } from "../../lib/plural";
import { moneyFormat } from "../../lib/money";

export const metadata = { title: "Players" };

const STATUS_TONE: Record<PlayerIndexRow["status"], KitTone> = {
  submitted: "blue",
  approved: "green",
  waitlisted: "amber",
  rejected: "red",
  withdrawn: "neutral",
};

// "Not paid" is neutral here: this index spans seasons, most of which charge no
// fee at all, and forty amber pills for money nobody asked for read as forty
// problems. The season's own desk colours it when that season records fees.
const FEE_TONE: Record<PlayerIndexRow["feeStatus"], KitTone> = {
  pending: "neutral",
  paid: "green",
  waived: "blue",
  refunded: "neutral",
};

const ROUTE_LABEL: Record<NonNullable<PlayerIndexRow["squadRoute"]>, string> = {
  auction: "Bought",
  icon: "Icon",
  captain: "Captain",
  retained: "Retained",
};

function count(value: number): string {
  return formatCount(value);
}

/** The page's own query string, with `patch` applied — for the stat cards and pager. */
function hrefWith(
  current: Readonly<Record<string, string>>,
  patch: Readonly<Record<string, string>>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (value !== "") next.set(key, value);
  }
  const qs = next.toString();
  return qs === "" ? "/players" : `/players?${qs}`;
}

/**
 * /players — every player across the seasons this person reviews.
 *
 * Gated per season on `registration.review` (the registrations desk's own
 * gate) before any row is read; see `server/console/views.ts`. A row opens the
 * player's sheet on that season's desk — the same deep link the desk uses.
 */
export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const one = (key: string): string | undefined => {
    const value = raw[key];
    return typeof value === "string" ? value : undefined;
  };
  const view = await playersIndexView({
    q: one("q"),
    season: one("season"),
    status: one("status"),
    team: one("team"),
    mark: one("mark"),
    page: one("page"),
  });

  if (view.seasons.length === 0) {
    return (
      <main className="px-players">
        <section className="px-empty" data-testid="players-empty">
          <EmptyState
            icon={<IconUsers />}
            title="No players to manage yet"
            headingLevel={2}
            description={
              <>
                This page lists every player in the seasons you run — as a club owner or staff. You
                don&rsquo;t review registrations for any season yet.
              </>
            }
            action={
              <>
                {view.ownsTeam !== null ? (
                  <NavButton
                    href={`/seasons/${view.ownsTeam.seasonSlug}/teams`}
                    variant="primary"
                    size="touch"
                  >
                    Your squad · {view.ownsTeam.name}
                  </NavButton>
                ) : null}
                <NavButton
                  href="/c"
                  variant={view.ownsTeam === null ? "primary" : "secondary"}
                  size="touch"
                >
                  <IconGlobe size={18} aria-hidden /> Find tournaments
                </NavButton>
                {view.plays ? (
                  <NavButton href="/me" variant="secondary" size="touch">
                    <IconStar size={18} aria-hidden /> My profile
                  </NavButton>
                ) : null}
              </>
            }
          />
        </section>
      </main>
    );
  }

  const { filters, result } = view;
  const current = { ...filters, page: view.page > 1 ? String(view.page) : "" };
  const isAll = filters.status === "" && filters.mark === "";
  const multiSeason = view.seasons.length > 1;

  /* Fees are a column only where some fee was ever recorded: a points season
     printed "Not paid" on every row — noise, and slightly alarming. */
  const showFee = result.rows.some((row) => row.feeStatus !== "pending");
  /* THE TABS SPLIT THE LIST (2026-09-28). "Approved 43" beside "All 43" was
     the same list twice; the organizer's questions after a room are sold,
     unsold and pre-signed — and before one, who is still waiting. */
  const { stats } = result;
  const segments = [
    {
      key: "all",
      label: "All",
      count: count(stats.total),
      href: hrefWith(current, { status: "", mark: "", page: "" }),
      active: isAll,
      testId: "players-stat-all",
    },
    ...(stats.toReview > 0
      ? [
          {
            key: "review",
            label: "To review",
            count: count(stats.toReview),
            href: hrefWith(current, { status: "submitted", mark: "", page: "" }),
            active: filters.status === "submitted" && filters.mark === "",
            testId: "players-stat-review",
          },
        ]
      : []),
    ...(stats.sold > 0 || stats.unsold > 0
      ? [
          {
            key: "sold",
            label: "Sold",
            count: count(stats.sold),
            href: hrefWith(current, { mark: "sold", status: "", page: "" }),
            active: filters.mark === "sold",
            testId: "players-stat-sold",
          },
          {
            key: "unsold",
            label: "Unsold",
            count: count(stats.unsold),
            href: hrefWith(current, { mark: "unsold", status: "", page: "" }),
            active: filters.mark === "unsold",
            testId: "players-stat-unsold",
          },
        ]
      : []),
    {
      key: "presigned",
      label: "Pre-signed",
      count: count(stats.preSigned),
      href: hrefWith(current, { mark: "presigned", status: "", page: "" }),
      active: filters.mark === "presigned",
      testId: "players-stat-presigned",
    },
  ];
  /* One season in view: the line names it and its spend, and the door to add
     players goes to that season's desk (where Add player and the import are).
     Across seasons a sum of rupees and points would be no number at all. */
  const oneSeason = view.seasons.length === 1 ? view.seasons[0] : undefined;
  const scopedSeason = oneSeason ?? view.seasons.find((season) => season.slug === filters.season);
  const unit = result.rows[0]?.auctionUnit ?? "inr";
  const summary = [
    stats.sold > 0
      ? `${count(stats.sold)} sold${
          scopedSeason !== undefined ? ` for ${moneyFormat(unit).ledger(stats.spent)}` : ""
        }`
      : null,
    stats.unsold > 0 ? `${count(stats.unsold)} unsold` : null,
    stats.preSigned > 0 ? `${count(stats.preSigned)} pre-signed` : null,
    stats.toReview > 0 ? `${count(stats.toReview)} to review` : null,
  ].filter((part): part is string => part !== null);

  return (
    <main className="px-players">
      <header className="px-head">
        <p className="px-summary" data-testid="players-summary">
          <strong>{stats.total === 1 ? "1 player" : `${count(stats.total)} players`}</strong>{" "}
          {scopedSeason !== undefined
            ? `in ${scopedSeason.name}`
            : `across ${count(view.seasons.length)} seasons`}
          {summary.length > 0 ? ` · ${summary.join(" · ")}` : ""}
        </p>
        {scopedSeason !== undefined ? (
          <NavButton
            href={`/seasons/${scopedSeason.slug}/registrations`}
            variant="primary"
            size="sm"
          >
            + Add players
          </NavButton>
        ) : null}
      </header>
      <section className="px-card" data-testid="players-card" aria-label="All players">
        {/* The shared list head (round 2): the status tabs are the card's
            first row and the toolbar its second — the same geometry as the
            season's Registrations desk, so the two lists read as one kit. */}
        <div className="px-tabs">
          <SegmentedTabs label="Show players" items={segments} testId="players-stats" />
        </div>
        <PlayersFilters
          current={filters}
          seasons={view.seasons}
          teams={view.teams.map((team) => ({
            id: team.id,
            label: multiSeason ? `${team.name} · ${team.seasonName}` : team.name,
          }))}
          countLabel={result.total === 1 ? "1 player" : `${count(result.total)} players`}
        />
        {result.rows.length === 0 ? (
          <p className="px-none" role="status">
            No players match these filters.
          </p>
        ) : (
          <div className="px-table-wrap">
            <table className="px-table" data-testid="players-table">
              <caption className="px-visually-hidden">
                Players across your seasons. Select a name to open their sheet.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  {multiSeason ? <th scope="col">Season</th> : null}
                  <th scope="col">Team</th>
                  <th scope="col" className="px-num">
                    Price
                  </th>
                  {showFee ? <th scope="col">Fee</th> : null}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.registrationId} data-testid={`players-row-${row.registrationId}`}>
                    <td className="px-cell-player">
                      <div className="px-player">
                        <PlayerImage
                          name={row.name ?? "Player"}
                          seed={row.registrationId}
                          src={row.photoUrl}
                          size="sm"
                          shape="round"
                          decorative
                          {...(row.teamColor !== null ? { teamColor: row.teamColor } : {})}
                        />
                        <span className="px-player-text">
                          <Link
                            href={`/seasons/${row.seasonSlug}/registrations?player=${row.registrationId}`}
                            className="px-row-link"
                          >
                            {row.name ?? "Unnamed player"}
                          </Link>
                          {/* The role, not "RA67NAW": the registration
                              number is an internal handle (still searchable,
                              and on the sheet). Status speaks only when it is
                              not the usual "approved". */}
                          <span className="px-sub">
                            {row.role ?? "Player"}
                            <span className="px-sub-phone">
                              {row.teamName !== null ? ` · ${row.teamName}` : ""}
                            </span>
                            {row.status !== "approved" ? (
                              <>
                                {" "}
                                <Pill tone={STATUS_TONE[row.status]} dot>
                                  {STATUS_LABEL[row.status]}
                                </Pill>
                              </>
                            ) : null}
                          </span>
                        </span>
                      </div>
                    </td>
                    {multiSeason ? (
                      <td className="px-cell-season" data-label="Season">
                        {row.seasonName}
                      </td>
                    ) : null}
                    <td className="px-cell-team" data-label="Team">
                      {row.teamName !== null ? (
                        <TeamChip color={row.teamColor}>{row.teamName}</TeamChip>
                      ) : (
                        <span className="px-dash">—</span>
                      )}
                    </td>
                    <td className="px-cell-price px-num" data-label="Price">
                      {row.soldPrice !== null ? (
                        <strong>{moneyFormat(row.auctionUnit).ledger(row.soldPrice)}</strong>
                      ) : row.squadRoute !== null && row.squadRoute !== "auction" ? (
                        <span className="px-route">{ROUTE_LABEL[row.squadRoute]}</span>
                      ) : row.status === "approved" && row.auctionDone ? (
                        <span className="px-how">Unsold</span>
                      ) : (
                        <span className="px-dash">—</span>
                      )}
                    </td>
                    {showFee ? (
                      <td className="px-cell-fee" data-label="Fee">
                        <Pill tone={FEE_TONE[row.feeStatus]}>{FEE_LABEL[row.feeStatus]}</Pill>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view.pageCount > 1 ? (
          <div className="px-pager">
            <Pager
              total={result.total}
              page={view.page}
              pageCount={view.pageCount}
              pageSize={PLAYERS_PAGE_SIZE}
              noun="players"
              hrefFor={(number) => hrefWith(current, { page: number === 1 ? "" : String(number) })}
              linkComponent={Link}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}
