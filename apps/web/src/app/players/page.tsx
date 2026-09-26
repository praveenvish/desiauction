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
import { RegistrationStatusGlyph } from "../../components/status/registration-status-glyph";
import "./players.css";
import { formatCount } from "../../lib/plural";

export const metadata = { title: "Players · DesiAuction" };

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
  auction: "Bought at auction",
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
                    <IconStar size={18} aria-hidden /> My sports
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
  const segments = [
    {
      key: "all",
      label: "All",
      count: count(result.stats.total),
      href: hrefWith(current, { status: "", mark: "", page: "" }),
      active: isAll,
      testId: "players-stat-all",
    },
    {
      key: "approved",
      label: "Approved",
      count: count(result.stats.approved),
      href: hrefWith(current, { status: "approved", mark: "", page: "" }),
      active: filters.status === "approved" && filters.mark === "",
      testId: "players-stat-approved",
    },
    {
      key: "sold",
      label: "Sold",
      count: count(result.stats.sold),
      href: hrefWith(current, { mark: "sold", status: "", page: "" }),
      active: filters.mark === "sold",
      testId: "players-stat-sold",
    },
    {
      key: "presigned",
      label: "Pre-signed",
      count: count(result.stats.preSigned),
      href: hrefWith(current, { mark: "presigned", status: "", page: "" }),
      active: filters.mark === "presigned",
      testId: "players-stat-presigned",
    },
  ];

  return (
    <main className="px-players">
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
                  <th scope="col">Role</th>
                  <th scope="col">Team</th>
                  <th scope="col">Status</th>
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
                          <span className="px-sub">
                            {row.number}
                            {/* The phone row's second line carries the role
                                and team the hidden cells hold on a laptop. */}
                            <span className="px-sub-phone">
                              {row.role !== null ? ` · ${row.role}` : ""}
                              {row.teamName !== null
                                ? ` · ${row.teamName}`
                                : row.auctionDone && row.status === "approved"
                                  ? " · Unsold"
                                  : ""}
                            </span>
                          </span>
                        </span>
                      </div>
                    </td>
                    {multiSeason ? (
                      <td className="px-cell-season" data-label="Season">
                        {row.seasonName}
                      </td>
                    ) : null}
                    <td className="px-cell-role" data-label="Role">
                      {row.role !== null ? (
                        <span className="px-role">{row.role}</span>
                      ) : (
                        <span className="px-dash">—</span>
                      )}
                    </td>
                    <td className="px-cell-team" data-label="Team">
                      {row.teamName !== null ? (
                        <span className="px-team">
                          <TeamChip color={row.teamColor}>{row.teamName}</TeamChip>
                          {row.squadRoute !== null && row.squadRoute !== "auction" ? (
                            <span className="px-route">{ROUTE_LABEL[row.squadRoute]}</span>
                          ) : null}
                        </span>
                      ) : row.auctionDone && row.status === "approved" ? (
                        // "Unsold" once the room has run — the season desk's word
                        // too — and a dash before it, when nobody is placed yet.
                        <Pill tone="neutral">Unsold</Pill>
                      ) : (
                        <span className="px-dash">—</span>
                      )}
                    </td>
                    <td className="px-cell-status" data-label="Status">
                      <RegistrationStatusGlyph status={row.status} />
                      <Pill tone={STATUS_TONE[row.status]} dot>
                        {STATUS_LABEL[row.status]}
                      </Pill>
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
