"use client";

import {
  Button,
  EmptyState,
  Field,
  IconArrowLeft,
  IconArrowRight,
  IconChart,
  IconCrown,
  IconDownload,
  IconFlag,
  IconInfo,
  IconLock,
  IconRupee,
  IconSearch,
  IconTrophy,
  IconUser,
  IconUsers,
  IconWallet,
  initialsFor,
  Notice,
  paintOnFill,
  Pill,
  PlayerImage,
  SectionCard,
  StatCard,
  StatGrid,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";

import { HashTabs } from "../../../../components/hash-tabs/hash-tabs";
import { PageTitle } from "../../../../components/shell/page-title";
import { formatPhone } from "../../../../lib/format-phone";
import { setTeamCoachAction, updateTeamAction } from "../../../../server/competition/actions";
import type { TeamsWorkspaceView } from "../../../../server/competition/actions";
import type { TeamCard } from "../../../../server/competition/team-workspace";
import { inviteOwnerAction } from "../../../../server/auction/owner-actions";
import { ExportDialog } from "../_players/export-dialog";
import { RosterSheetHost, SquadPreSign } from "./squad-desk";
import { TeamLogoUploader } from "./team-logo-uploader";

/** "₹74,31,250" — exact rupees, Indian grouping. */
function exactINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

/** "₹2 Cr" — the compact purse figure for the header line. */
function compactINR(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 10_000_000) return `₹${String(Math.round((rupees / 10_000_000) * 100) / 100)} Cr`;
  if (rupees >= 100_000) return `₹${String(Math.round((rupees / 100_000) * 100) / 100)} L`;
  return `₹${rupees.toLocaleString("en-IN")}`;
}

/**
 * DA-36: ONE monogram algorithm for a team, everywhere.
 *
 * The card header derived it from the raw name's first three letters while the
 * crest uploader in Team settings derived it from the first and last word — so
 * "Cup Kings" was "CUP" on one and "CK" on the other, two marks for one
 * identity. Worse, first-three collapsed whole leagues: Demo Falcons, Demo
 * Panthers, Demo Tigers and Demo Wolves all rendered "DEM".
 *
 * `initialsFor` is what the crest primitive uses, so agreeing with it is the
 * only way both surfaces can be right; it is also per-WORD, which is what keeps
 * four "Demo …" teams apart. The organizer's own short name is not lost — it is
 * rendered beside the team name, where it can be read in full.
 */
function monogram(team: { name: string }): string {
  return initialsFor(team.name).initials ?? "?";
}

export function TeamsPanel({
  view,
  slug,
  selected,
}: {
  view: TeamsWorkspaceView;
  slug: string;
  selected: TeamCard | null;
}) {
  if (selected !== null) {
    return <RosterDetail slug={slug} team={selected} view={view} />;
  }
  return <TeamGrid view={view} slug={slug} />;
}

/* --- The franchise grid ---------------------------------------------------- */

function TeamGrid({ view, slug }: { view: TeamsWorkspaceView; slug: string }) {
  const [query, setQuery] = useState("");
  const locked = view.rulesSource?.locked ?? false;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return view.teams;
    return view.teams.filter(
      (team) =>
        team.name.toLowerCase().includes(needle) ||
        (team.shortName ?? "").toLowerCase().includes(needle),
    );
  }, [query, view.teams]);

  return (
    <>
      {/* The page head's lede: the shell draws the trail and the one <h1>
          ("Teams"), and the season's facts follow it here. */}
      <div className="tm-lede">
        <p className="tm-lede-count" data-testid="teams-count">
          {view.teams.length} team{view.teams.length === 1 ? "" : "s"} · {view.approvedPlayers}{" "}
          approved player{view.approvedPlayers === 1 ? "" : "s"}
        </p>
        {/* DA-39: the purse figure used to appear with no provenance — no link
            to where it was set, no lock indicator — and vanished entirely while
            the decision was still open. It is a default an organizer accepted
            in "Rules of the night", so it says so and links there. */}
        {view.purseTotal !== undefined ? (
          <p className="tm-lede-rules" data-testid="purse-provenance">
            {view.purseTotal > 0 ? (
              <>
                Purse {compactINR(view.purseTotal)} per team
                {view.squadMax !== undefined && view.squadMax !== null
                  ? `, squad of ${String(view.squadMax)}`
                  : ""}{" "}
                — {locked ? "locked when the auction started." : "set in the auction's rules."}{" "}
                <Link className="tm-lede-link" href={`/seasons/${slug}/auction`}>
                  Rules of the night
                  <IconArrowRight size={14} className="icon-trail" aria-hidden />
                </Link>
              </>
            ) : (
              <>
                No purse is set yet. It is chosen in{" "}
                <Link className="tm-lede-link" href={`/seasons/${slug}/auction`}>
                  Rules of the night
                </Link>{" "}
                when the auction is created.
              </>
            )}
          </p>
        ) : null}
      </div>

      {/* DA-40: the auction lock is season state, not a validation failure on a
          text input. It is now stated before the form, not after the submit. */}
      {locked && view.viewer.canManageTeams ? (
        <Notice tone="warning" icon={<IconLock size={20} />} testId="teams-locked-notice">
          The auction has started, so the team list is locked for this season. Teams stay editable
          until you go live.
        </Notice>
      ) : null}

      {/* DA-41: this screen says "add the teams that will bid" and had no concept
          of the person who bids — every link led to Registrations or back here.
          It now names the real order and links to the step that unblocks it. */}
      {view.viewer.canManageTeams && view.rulesSource === null && view.teams.length > 0 ? (
        <Notice tone="info" icon={<IconInfo size={20} />} testId="teams-owner-hint">
          Next: <Link href={`/seasons/${slug}/auction`}>create the auction</Link>, then invite an
          owner for each team from its page here. You can keep adding teams until the auction goes
          live.
        </Notice>
      ) : null}

      {/* A league of eight fits on a screen; past that, finding one needs a box. */}
      {view.teams.length > 8 ? (
        <div className="tm-toolbar">
          <IconSearch size={16} className="tm-toolbar-icon" aria-hidden />
          <input
            type="search"
            className="tm-search"
            placeholder="Search teams…"
            aria-label="Search teams"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
      ) : null}

      {view.teams.length === 0 ? (
        <SectionCard
          icon={<IconUsers />}
          title="No teams yet"
          description={
            view.viewer.canManageTeams
              ? "The auction needs at least two teams. Add the first one with “Add team” above."
              : "The organizer hasn't added any teams yet."
          }
          data-testid="teams-empty"
        />
      ) : (
        <ul className="tm-grid" data-testid="teams-list">
          {shown.map((team) => (
            <li key={team.id}>
              <TeamGridCard team={team} slug={slug} />
            </li>
          ))}
          {shown.length === 0 ? <li className="tm-grid-empty">No teams match “{query}”.</li> : null}
        </ul>
      )}
    </>
  );
}

/** A team's mark: its crest, else its initials on its own colour. */
function Crest({ team, size }: { team: TeamCard; size: "md" | "lg" }) {
  const px = size === "lg" ? 64 : 44;
  return team.logoUrl !== null ? (
    <img className="tm-crest" data-size={size} src={team.logoUrl} alt="" width={px} height={px} />
  ) : (
    <span
      className="tm-crest tm-crest-mono"
      data-size={size}
      style={paintOnFill(team.color)}
      aria-hidden
    >
      {monogram(team)}
    </span>
  );
}

/** The team's colour as a custom property — every bar and wash on the card reads it. */
function teamPaint(color: string | null): CSSProperties | undefined {
  return color !== null ? ({ "--team": color } as CSSProperties) : undefined;
}

function TeamGridCard({ team, slug }: { team: TeamCard; slug: string }) {
  const remaining =
    team.purseTotal !== undefined && team.spent !== undefined
      ? Math.max(0, team.purseTotal - team.spent)
      : null;
  const owner = team.ownerName !== null ? `Owner · ${team.ownerName}` : "No owner yet";
  const full =
    team.squadMax !== undefined && team.squadMax !== null && team.squadFilled >= team.squadMax;
  return (
    <article className="team-card tm-card" style={teamPaint(team.color)}>
      <div className="tm-card-top">
        <Crest team={team} size="md" />
        <div className="tm-card-id">
          <span className="tm-card-name">
            {team.name}
            {team.shortName !== null ? (
              <span className="tm-card-short">{team.shortName}</span>
            ) : null}
          </span>
          <span className="tm-card-owner" title={owner}>
            {owner}
          </span>
        </div>
        <span className="tm-card-squad" data-full={full ? "true" : undefined}>
          {team.squadMax !== undefined && team.squadMax !== null ? (
            <>
              {team.squadFilled}/{team.squadMax}
              <VisuallyHidden> players in the squad</VisuallyHidden>
            </>
          ) : (
            <>
              {team.squadFilled}
              <VisuallyHidden> {team.squadFilled === 1 ? "player" : "players"}</VisuallyHidden>
            </>
          )}
        </span>
      </div>

      {team.usedPct !== undefined && team.usedPct !== null ? (
        <div className="tm-card-purse">
          <div className="tm-card-purse-head">
            <span>Purse used</span>
            <span className="tm-num">{team.usedPct}%</span>
          </div>
          <span className="tm-bar" aria-hidden>
            <span
              className="tm-bar-fill"
              style={{ transform: `scaleX(${String(Math.min(100, team.usedPct) / 100)})` }}
            />
          </span>
        </div>
      ) : null}

      {team.spent !== undefined ? (
        <dl className="tm-card-money">
          <div>
            <dt>Spent</dt>
            <dd className="tm-num">{exactINR(team.spent)}</dd>
          </div>
          <div>
            <dt>Remaining</dt>
            <dd className="tm-num" data-tone={remaining === 0 ? "out" : "left"}>
              {/* DA-24: no auction yet means no purse yet — "₹0" read as broke. */}
              {remaining !== null && (team.purseTotal ?? 0) > 0 ? exactINR(remaining) : "—"}
            </dd>
          </div>
        </dl>
      ) : null}

      {team.topBuyName !== undefined ? (
        <p className="tm-topbuy" data-empty={team.topBuyName === null ? "true" : undefined}>
          <IconTrophy size={18} className="tm-topbuy-icon" aria-hidden />
          {team.topBuyName !== null ? (
            <>
              <span className="tm-topbuy-name">
                <VisuallyHidden>Top buy: </VisuallyHidden>
                {team.topBuyName}
              </span>
              {team.topBuyPrice !== undefined && team.topBuyPrice !== null ? (
                <span className="tm-num tm-topbuy-price">{exactINR(team.topBuyPrice)}</span>
              ) : null}
            </>
          ) : (
            <span className="tm-topbuy-name">No buys yet</span>
          )}
        </p>
      ) : null}

      {/* DA-43: the card IS the target (SC 2.5.8). The link's ::after covers
          the whole card, and its accessible name is still its own text. */}
      <Link
        href={`/seasons/${slug}/teams?team=${team.id}`}
        className="tm-card-link team-card-cover"
        data-testid={`open-roster-${team.id}`}
      >
        View team
        <IconArrowRight size={16} className="icon-trail" aria-hidden />
      </Link>
    </article>
  );
}

/* --- One team's roster ----------------------------------------------------- */

function RosterDetail({
  slug,
  team,
  view,
}: {
  slug: string;
  team: TeamCard;
  view: TeamsWorkspaceView;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const closeSheet = useCallback(() => {
    setSheetId(null);
  }, []);
  const canManage = view.viewer.canManageTeams;
  /**
   * The SEASON's role labels. `roleLabel` asks cricket and falls back to the
   * key with its underscores swapped, so a football roster read "midfielder"
   * in a column of Title Case, and any pack whose label is not just its key
   * prettified would have read plainly wrong.
   */
  const labelOf = useMemo(() => {
    const byKey = new Map(view.roles.map((role) => [role.key, role.label]));
    return (role: string | null): string =>
      role === null ? "" : (byKey.get(role) ?? role.replace(/_/g, " "));
  }, [view.roles]);
  const remaining =
    team.purseTotal !== undefined && team.spent !== undefined
      ? Math.max(0, team.purseTotal - team.spent)
      : null;
  const slotsOpen =
    team.squadMax !== undefined && team.squadMax !== null
      ? Math.max(0, team.squadMax - team.squadFilled)
      : null;
  // `?? []` mints a new array whenever a team carries no roster, so the tally
  // below recomputed on every render of a squad page that had nothing to tally.
  const roster = useMemo(() => team.roster ?? [], [team.roster]);

  // The per-role tally chips, in the design's fixed order.
  const tally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of roster) {
      // A sport with no playing roles has no tally to show.
      if (row.role === null) {
        continue;
      }
      counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
    }
    // The pack declares the order; the design's "fixed order" IS that order.
    // THIS SEASON's pack, that is — it used to be cricket's for every sport,
    // under a comment that said the pack decides. An unknown role still sorts
    // first, exactly as it did before.
    const order: readonly string[] = view.roles.map((role) => role.key);
    return [...counts.entries()].sort(
      (a, b) => order.indexOf(a[0]) + 100 - (order.indexOf(b[0]) + 100),
    );
  }, [roster, view.roles]);

  const squadSection = (
    <div className="tm-squad-tab">
      {canManage && view.viewer.canSeeRoster ? (
        <SectionCard
          className="tm-presign-card"
          icon={<IconCrown />}
          tone="amber"
          title="Captain, icons & retained"
          description="Named before the auction — they join this squad without being bid for."
        >
          <SquadPreSign
            slug={slug}
            teamId={team.id}
            teamName={team.name}
            teamColor={team.color}
            roster={roster}
            locked={view.rulesSource?.locked ?? false}
            settlesAtOpen={view.rulesSource !== null && !view.rulesSource.locked}
          />
        </SectionCard>
      ) : null}

      {view.viewer.canSeeRoster ? (
        <SectionCard
          flush
          icon={<IconUsers />}
          title="Squad"
          description={
            roster.length === 0
              ? undefined
              : `${String(roster.length)} player${roster.length === 1 ? "" : "s"}${
                  view.viewer.canSeeMoney ? " · dearest buy first" : ""
                }`
          }
          action={
            tally.length > 0 ? (
              <span className="tm-tally">
                {tally.map(([role, count]) => (
                  <Pill key={role} tone="neutral">
                    {labelOf(role)} <b>{count}</b>
                  </Pill>
                ))}
              </span>
            ) : undefined
          }
        >
          {roster.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title="No players on this squad yet"
              description={
                canManage
                  ? "Pick the captain and any icons above — everyone else joins at the auction."
                  : "Players land here when they're won at auction or pre-signed by the organizer."
              }
            />
          ) : (
            <div className="table-scroll tm-roster-scroll">
              <table className="tm-roster" data-testid="roster-list">
                <thead>
                  <tr>
                    <th className="tm-roster-num">#</th>
                    <th>Player</th>
                    <th>Role</th>
                    {view.viewer.canSeeMoney ? (
                      <th className="tm-roster-price">Buy price</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((row, index) => (
                    <tr
                      key={row.registrationId}
                      className="pd-roster-row"
                      data-open={sheetId === row.registrationId ? "true" : undefined}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("button, a") === null) {
                          setSheetId(row.registrationId);
                        }
                      }}
                    >
                      <td className="tm-roster-num">{index + 1}</td>
                      <td>
                        <span className="tm-roster-player">
                          {/* The player's photo (consent-gated upstream), else the same
                              branded initials mark every other surface draws for them. */}
                          <PlayerImage
                            name={row.name ?? "Unnamed"}
                            seed={row.registrationId}
                            src={row.photoUrl}
                            size="sm"
                            shape="round"
                            teamColor={team.color ?? undefined}
                            decorative
                          />
                          <span className="tm-roster-person">
                            <span className="tm-roster-name">
                              <button
                                type="button"
                                className="pd-player-name"
                                onClick={() => {
                                  setSheetId(row.registrationId);
                                }}
                              >
                                {row.name ?? "Unnamed"}
                              </button>
                              {row.isCaptain ? <Pill tone="blue">Captain</Pill> : null}
                              {row.isIcon ? <Pill tone="amber">Icon</Pill> : null}
                              {row.isRetained ? <Pill tone="purple">Retained</Pill> : null}
                            </span>
                            {/* A player always has one — `submitRegistration` refuses an
                                account with no number, because SMS is the only way a
                                season reaches them. The fallback is for the rows that
                                predate that rule, not a state the product creates. */}
                            <span className="tm-roster-phone">
                              {row.phone !== null ? formatPhone(row.phone) : "—"}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td data-label="Role">{labelOf(row.role) || "—"}</td>
                      {view.viewer.canSeeMoney ? (
                        <td className="tm-roster-price tm-num" data-label="Buy price">
                          {row.buyPrice !== undefined && row.buyPrice !== null
                            ? exactINR(row.buyPrice)
                            : row.isCaptain || row.isIcon || row.isRetained
                              ? "Pre-signed"
                              : "—"}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard
          icon={<IconLock />}
          tone="neutral"
          title="The squad is not yours to see"
          description="Reviewing this season's players needs the registration-review permission. Ask an organizer of this season for it."
        />
      )}
    </div>
  );

  return (
    <>
      <Link href={`/seasons/${slug}/teams`} className="teams-back tm-back">
        <IconArrowLeft size={16} className="icon-lead" /> All teams
      </Link>

      {/* Selecting a team is a URL state of the Teams surface, so the shell's
          title follows it rather than the page growing a second <h1>. This
          band carries everything about the team except its name. */}
      <PageTitle title={team.name} />
      <section className="tm-hero" style={teamPaint(team.color)} aria-label="About this team">
        <Crest team={team} size="lg" />
        <div className="tm-hero-id">
          {team.shortName !== null ? (
            <p className="tm-hero-eyebrow">
              <span className="tm-card-short">{team.shortName}</span>
            </p>
          ) : null}
          <ul className="tm-hero-meta">
            <li>
              <IconUser size={16} aria-hidden />
              {team.ownerName !== null ? `Owner · ${team.ownerName}` : "No owner yet"}
            </li>
            {team.coachName !== null ? (
              <li>
                <IconFlag size={16} aria-hidden />
                Coach · {team.coachName}
              </li>
            ) : null}
            <li>
              <IconUsers size={16} aria-hidden />
              {slotsOpen !== null && team.squadMax !== undefined && team.squadMax !== null
                ? `${String(team.squadFilled)}/${String(team.squadMax)} squad · ${String(slotsOpen)} slot${slotsOpen === 1 ? "" : "s"} open`
                : `${String(team.squadFilled)} player${team.squadFilled === 1 ? "" : "s"}`}
            </li>
          </ul>
        </div>
        {view.viewer.canSeeRoster ? (
          <div className="tm-hero-actions">
            <Button
              variant="secondary"
              size="sm"
              data-testid="export-squad"
              onClick={() => {
                setExportOpen(true);
              }}
            >
              <IconDownload size={16} className="icon-lead" aria-hidden />
              Export squad
            </Button>
          </div>
        ) : null}
      </section>

      {team.spent !== undefined ? (
        <StatGrid>
          <StatCard
            icon={<IconWallet />}
            tone="gold"
            value={exactINR(team.spent)}
            label="Purse spent"
          />
          <StatCard
            icon={<IconRupee />}
            tone="green"
            value={remaining !== null && (team.purseTotal ?? 0) > 0 ? exactINR(remaining) : "—"}
            label="Remaining"
          />
          <StatCard
            icon={<IconChart />}
            tone="blue"
            value={
              team.usedPct !== undefined && team.usedPct !== null ? `${String(team.usedPct)}%` : "—"
            }
            label="Purse used"
            {...(team.usedPct !== undefined && team.usedPct !== null
              ? { progress: team.usedPct }
              : {})}
          />
          <StatCard
            icon={<IconTrophy />}
            tone="amber"
            value={<span className="tm-stat-name">{team.topBuyName ?? "—"}</span>}
            label="Top buy"
            {...(team.topBuyPrice !== undefined && team.topBuyPrice !== null
              ? { hint: exactINR(team.topBuyPrice) }
              : {})}
          />
        </StatGrid>
      ) : null}

      {/* Two tabs rather than one long page: the squad is what an organizer
          comes here for; crest, name, coach and owner are set once. */}
      {canManage ? (
        <HashTabs
          label="Team sections"
          tabs={[
            { id: "squad", label: "Squad", badge: roster.length, content: squadSection },
            {
              id: "settings",
              label: "Team settings",
              content: (
                <div className="team-settings-tab">
                  <div className="teams-manage">
                    <TeamLogoUploader
                      slug={slug}
                      teamId={team.id}
                      teamName={team.name}
                      {...(team.logoUrl !== null ? { currentUrl: team.logoUrl } : {})}
                    />
                    <div className="teams-settings-forms">
                      <TeamIdentityEditor
                        slug={slug}
                        team={team}
                        locked={view.rulesSource?.locked ?? false}
                      />
                      <CoachEditor slug={slug} teamId={team.id} initial={team.coachName ?? ""} />
                      <OwnerInvite
                        slug={slug}
                        teamId={team.id}
                        ownerName={team.ownerName}
                        canConduct={view.viewer.canConduct}
                        auctionExists={view.rulesSource !== null}
                        auctionFinished={view.rulesSource?.finished ?? false}
                      />
                    </div>
                  </div>
                </div>
              ),
            },
          ]}
        />
      ) : (
        squadSection
      )}

      <ExportDialog
        slug={slug}
        open={exportOpen}
        onClose={() => {
          setExportOpen(false);
        }}
        sportAttributes={view.sportAttributes}
        teams={view.teams.map((entry) => ({ id: entry.id, name: entry.name }))}
        fixedTeam={{ id: team.id, name: team.name }}
      />

      {sheetId !== null ? (
        <RosterSheetHost
          slug={slug}
          registrationId={sheetId}
          teams={view.teams.map((entry) => ({ id: entry.id, name: entry.name }))}
          order={roster.map((row) => row.registrationId)}
          onNavigate={setSheetId}
          onClose={closeSheet}
        />
      ) : null}
    </>
  );
}

/**
 * DA-35: rename / recolour a team. There was no way to change any of this after
 * creation, so a typo in a franchise name was permanent for the season.
 */
function TeamIdentityEditor({
  slug,
  team,
  locked,
}: {
  slug: string;
  team: TeamCard;
  locked: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [shortName, setShortName] = useState(team.shortName ?? "");
  const [color, setColor] = useState(team.color ?? "#1f6f43");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  if (locked) {
    return (
      <p className="teams-notice" data-testid="team-identity-locked">
        The auction has started, so this team&apos;s name, short name and colour are locked with it.
      </p>
    );
  }
  return (
    <div className="teams-form" data-testid="team-identity-editor">
      <Field
        ref={nameRef}
        label="Team name"
        name="edit-team-name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        {...(error !== null ? { error } : {})}
      />
      <Field
        label="Short name"
        name="edit-team-short"
        placeholder="MAV"
        value={shortName}
        onChange={(event) => {
          setShortName(event.target.value);
        }}
      />
      <Field
        label="Colour"
        name="edit-team-color"
        type="color"
        value={color}
        onChange={(event) => {
          setColor(event.target.value);
        }}
      />
      <Button
        variant="secondary"
        loading={saving}
        data-testid="save-team-identity"
        onClick={() => {
          setError(null);
          startSaving(async () => {
            const result = await updateTeamAction(slug, team.id, {
              name,
              shortName,
              primaryColor: color,
            });
            if (!result.ok) {
              setError(result.error ?? "That team couldn't be updated.");
              nameRef.current?.focus();
              return;
            }
            toast({ tone: "success", title: "Team updated" });
            router.refresh();
          });
        }}
      >
        Save team
      </Button>
    </div>
  );
}

/**
 * DA-41: the loop out of this screen. Owners were invited only from the auction
 * cockpit, so "add teams → give each an owner → configure the auction" could
 * never be done in that order. The invite is now offered where the teams are,
 * and when there is no auction to invite against, the screen says so and links
 * to the step that creates one.
 */
function OwnerInvite({
  slug,
  teamId,
  ownerName,
  canConduct,
  auctionExists,
  auctionFinished,
}: {
  slug: string;
  teamId: string;
  ownerName: string | null;
  canConduct: boolean;
  auctionExists: boolean;
  /** completed / reconciled / abandoned — the night is over. */
  auctionFinished: boolean;
}) {
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [minting, startMinting] = useTransition();

  if (!auctionExists) {
    return (
      <p className="teams-notice" data-testid="owner-invite-blocked">
        Owners are invited against the auction.{" "}
        <Link href={`/seasons/${slug}/auction`}>Create the auction</Link> first — teams stay
        editable until it goes live.
      </p>
    );
  }
  if (!canConduct) {
    return (
      <p className="teams-notice" data-testid="owner-invite-blocked">
        Inviting an owner needs the auction-conduct permission for this season.
      </p>
    );
  }
  // The panel derived blocked states for `!auctionExists` and `!canConduct` and
  // never asked what STATE the auction was in — so "Invite owner" was offered
  // on a completed auction and failed on click with "This auction has ended."
  if (auctionFinished) {
    return (
      <p className="teams-notice" data-testid="owner-invite-blocked">
        This auction has ended — owner invitations are closed for this season.
      </p>
    );
  }
  return (
    <div className="teams-settings-forms" data-testid="owner-invite">
      <p className="teams-form-label">
        {ownerName !== null ? `Owner · ${ownerName}` : "This team has no owner yet."}
      </p>
      {/* Stated where the organizer is about to act, not only in the help
          centre: there is no RevokeOwnerInvite command anywhere in the product
          (see the cockpit's Owners & paddles panel for the full note). */}
      <p className="teams-notice" data-testid="teams-owner-irrevocable">
        An owner link works once, expires in 7 days, and{" "}
        <strong>cannot be withdrawn once sent</strong> — anyone holding it can accept it.
      </p>
      <Button
        variant="secondary"
        loading={minting}
        data-testid="invite-owner-from-teams"
        onClick={() => {
          startMinting(async () => {
            const result = await inviteOwnerAction(slug, teamId);
            if (!result.ok) {
              toast({ tone: "danger", title: result.error });
              return;
            }
            setCopied(false);
            setUrl(`${window.location.origin}${result.joinPath}`);
            toast({ tone: "success", title: "Invitation link ready — send it to the owner." });
          });
        }}
      >
        {ownerName !== null ? "Invite another owner" : "Invite owner"}
      </Button>
      {url !== null ? (
        <>
          {/* The testid stays on the URL ALONE — it is read as text by the
              suites, which then navigate to it. */}
          <p className="teams-invite-url" data-testid="teams-owner-invite-url">
            {url}
          </p>
          <div className="teams-invite-actions">
            <Button
              size="touch"
              variant="secondary"
              data-testid="copy-teams-owner-invite"
              onClick={() => {
                void navigator.clipboard.writeText(url).then(
                  () => {
                    setCopied(true);
                  },
                  () => {
                    toast({
                      tone: "danger",
                      title: "Couldn't copy — select the link and copy it by hand.",
                    });
                  },
                );
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <span className="teams-notice">Send it yourself — the platform sends nothing.</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Inline coach editor for the selected team (non-bidding staff metadata). */
function CoachEditor({ slug, teamId, initial }: { slug: string; teamId: string; initial: string }) {
  const router = useRouter();
  const toast = useToast();
  // DA-42: the field opened blank whatever was saved, so the only way to keep a
  // coach was to retype the name; saving anything else silently cleared it.
  const [coach, setCoach] = useState(initial);
  const [saving, startSaving] = useTransition();
  return (
    <div className="teams-form" data-testid="coach-editor">
      <Field
        label="Coach"
        name="team-coach"
        placeholder="e.g. Ravi Shastri"
        value={coach}
        onChange={(event) => {
          setCoach(event.target.value);
        }}
      />
      <Button
        variant="secondary"
        loading={saving}
        onClick={() => {
          startSaving(async () => {
            const result = await setTeamCoachAction(slug, teamId, coach);
            if (!result.ok) {
              toast({ tone: "danger", title: result.error ?? "Couldn't save the coach." });
              return;
            }
            toast({ tone: "success", title: "Coach saved" });
            router.refresh();
          });
        }}
        data-testid="save-coach"
      >
        Save coach
      </Button>
    </div>
  );
}
