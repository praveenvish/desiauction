"use client";

import {
  Button,
  ButtonLink,
  EmptyState,
  Field,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconCrown,
  IconDownload,
  IconFlag,
  IconGavel,
  IconLock,
  IconSearch,
  IconTrophy,
  IconUser,
  IconUsers,
  initialsFor,
  paintOnFill,
  Pill,
  PlayerImage,
  SectionCard,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";

import { HashTabs } from "../../../../components/hash-tabs/hash-tabs";
import { useMoney, useMoneyUnit } from "../../../../components/money-unit";
import { PageTitle } from "../../../../components/shell/page-title";
import { CrestImage } from "../../../../components/team/crest-image";
import { formatPhone } from "../../../../lib/format-phone";
import { setTeamCoachAction, updateTeamAction } from "../../../../server/competition/actions";
import type { TeamsWorkspaceView } from "../../../../server/competition/actions";
import type { TeamCard } from "../../../../server/competition/team-workspace";
import { inviteOwnerAction } from "../../../../server/auction/owner-actions";
import { ExportDialog } from "../_players/export-dialog";
import { BoughtByHand, PublishByHand } from "./hand-entry";
import { RosterSheetHost, SquadPreSign } from "./squad-desk";
import { TeamLogoUploader } from "./team-logo-uploader";
import { captainOf, iconsOf, preSigned, roleMix, setupSteps, type RoleShare } from "./teams-model";

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
  beforeGrid,
  ownTeamId,
}: {
  view: TeamsWorkspaceView;
  slug: string;
  selected: TeamCard | null;
  /** The viewer's own team (an owner): its card leads and says so. */
  ownTeamId?: string;
  /**
   * Work that is waiting on the organizer (announcements, squad sheets),
   * drawn above the team cards rather than below them — the page's job right
   * after the auction is telling people, and it sat under eight cards.
   */
  beforeGrid?: ReactNode;
}) {
  if (selected !== null) {
    return <RosterDetail slug={slug} team={selected} view={view} />;
  }
  return <TeamGrid view={view} slug={slug} beforeGrid={beforeGrid} ownTeamId={ownTeamId} />;
}

/* --- The franchise grid ---------------------------------------------------- */

function TeamGrid({
  view,
  slug,
  beforeGrid,
  ownTeamId,
}: {
  view: TeamsWorkspaceView;
  slug: string;
  beforeGrid?: ReactNode;
  ownTeamId?: string | undefined;
}) {
  const money = useMoney();
  const [query, setQuery] = useState("");
  const locked = view.rulesSource?.locked ?? false;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // The owner's own team leads; everyone else keeps the season's order.
    const ordered =
      ownTeamId === undefined
        ? view.teams
        : [...view.teams].sort((a, b) => Number(b.id === ownTeamId) - Number(a.id === ownTeamId));
    if (needle === "") return ordered;
    return ordered.filter(
      (team) =>
        team.name.toLowerCase().includes(needle) ||
        (team.shortName ?? "").toLowerCase().includes(needle),
    );
  }, [query, view.teams, ownTeamId]);

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
                Purse {money.compact(view.purseTotal)} per team
                {view.squadMax !== undefined && view.squadMax !== null
                  ? `, squad of ${String(view.squadMax)}`
                  : ""}{" "}
                —{" "}
                {view.handEntry === "published"
                  ? "set when the results were published."
                  : locked
                    ? "locked when the auction started."
                    : "set in the auction's rules."}{" "}
                <Link className="tm-lede-link" href={`/seasons/${slug}/auction`}>
                  Rules of the night
                  <IconArrowRight size={14} className="icon-trail" aria-hidden />
                </Link>
              </>
            ) : view.handEntry === "open" && view.auctionSource === "imported" ? (
              <>No purse is set yet — you enter it when you publish the results.</>
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
        {/* DA-40: the auction lock is season state, stated before any form.
            A pill on the same line as the facts it qualifies, not a band. */}
        {locked && view.viewer.canManageTeams ? (
          <span className="tm-lock">
            <Pill tone="amber" icon={<IconLock />} testId="teams-locked-notice">
              {view.rulesSource?.finished === true
                ? "Locked — the auction is done"
                : "Locked — the auction has started"}
            </Pill>
          </span>
        ) : null}
      </div>

      {/* DA-41: this screen says "add the teams that will bid" and had no concept
          of the person who bids. Before the auction exists, THE next step is
          creating it — it sets the purse and squad size, and opens owner invites. */}
      {/* Not for a season run offline (0110): "Create the auction" refuses it,
          and its next step is typing the results in — the band below. */}
      {view.viewer.canManageTeams &&
      view.rulesSource === null &&
      view.auctionSource !== "imported" &&
      view.teams.length > 0 ? (
        <section className="tm-next" data-testid="teams-owner-hint" aria-labelledby="tm-next-title">
          <span className="tm-next-icon" aria-hidden>
            <IconGavel size={22} />
          </span>
          <span className="tm-next-text">
            <strong id="tm-next-title">Next: create the auction</strong>
            <span>
              It sets the purse and squad size for every team, and opens an owner invite for each.
              You can keep adding teams until the auction goes live.
            </span>
          </span>
          <ButtonLink href={`/seasons/${slug}/auction`} data-testid="teams-create-auction">
            Create the auction
            <IconArrowRight size={16} aria-hidden />
          </ButtonLink>
        </section>
      ) : null}

      {/* 0105: the auction happened in a hall, not here — type the results in. */}
      {view.handEntry === "open" && view.viewer.canSeeRoster && view.teams.length > 0 ? (
        <PublishByHand
          slug={slug}
          teams={view.teams}
          imported={view.auctionSource === "imported"}
          suggestedPurse={view.suggestedPurse ?? null}
        />
      ) : null}
      {view.handEntry === "published" ? (
        <section className="tm-next" data-testid="hand-published">
          <span className="tm-next-text">
            <strong>Results published</strong>
            <span>The squads are final. Posters and team cards now show them.</span>
          </span>
          <ButtonLink href={`/seasons/${slug}/posters`} data-testid="hand-make-posters">
            Make posters
            <IconArrowRight size={16} aria-hidden />
          </ButtonLink>
        </section>
      ) : null}

      {/* "Tell your players": announce and squad sheets sit side by side
          while both are to-dos, so the teams stay above the fold. */}
      {beforeGrid !== undefined ? <div className="tm-tell">{beforeGrid}</div> : null}

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
              <TeamGridCard team={team} slug={slug} own={team.id === ownTeamId} view={view} />
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
  const mono = (
    <span
      className="tm-crest tm-crest-mono"
      data-size={size}
      style={paintOnFill(team.color)}
      aria-hidden
    >
      {monogram(team)}
    </span>
  );
  return team.logoUrl !== null ? (
    <CrestImage
      className="tm-crest"
      data-size={size}
      src={team.logoUrl}
      width={px}
      height={px}
      loading="lazy"
      fallback={mono}
    />
  ) : (
    mono
  );
}

/** The team's colour as a custom property — every bar and wash on the card reads it. */
function teamPaint(color: string | null): CSSProperties | undefined {
  return color !== null ? ({ "--team": color } as CSSProperties) : undefined;
}

/** The squad's playing roles as one bar and its legend. */
function RoleMixBar({ shares }: { shares: RoleShare[] }) {
  if (shares.length === 0) return null;
  const total = shares.reduce((sum, share) => sum + share.count, 0);
  return (
    <div className="tm-mix">
      <span className="tm-mix-bar" aria-hidden>
        {shares.map((share) => (
          <i key={share.key} data-slot={String(share.slot % 6)} style={{ flexGrow: share.count }} />
        ))}
      </span>
      <ul className="tm-mix-legend" aria-label={`Squad by role, ${String(total)} players`}>
        {shares.map((share) => (
          <li key={share.key} data-slot={String(share.slot % 6)}>
            {share.label} <b>{share.count}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Spent and left on one bar, in the team's colour. */
function PurseLine({ team }: { team: TeamCard }) {
  const money = useMoney();
  if (team.spent === undefined || team.purseTotal === undefined || team.purseTotal <= 0) {
    return null;
  }
  const left = Math.max(0, team.purseTotal - team.spent);
  return (
    <div className="tm-purse">
      <span className="tm-purse-line">
        <span>
          <b className="tm-num">{money.exact(team.spent)}</b> spent
        </span>
        <span data-tone={left === 0 ? "out" : "left"}>
          <b className="tm-num">{money.exact(left)}</b> left
        </span>
      </span>
      <span className="tm-bar" aria-hidden>
        <span
          className="tm-bar-fill"
          style={{
            transform: `scaleX(${String(Math.min(100, team.usedPct ?? 0) / 100)})`,
          }}
        />
      </span>
    </div>
  );
}

function TeamGridCard({
  team,
  slug,
  own,
  view,
}: {
  team: TeamCard;
  slug: string;
  own: boolean;
  view: TeamsWorkspaceView;
}) {
  const money = useMoney();
  const roster = team.roster;
  const captain = roster === undefined ? null : captainOf(roster);
  const icons = roster === undefined ? [] : iconsOf(roster);
  const auctionExists = view.rulesSource !== null;
  const started = view.rulesSource?.locked ?? false;
  const full =
    team.squadMax !== undefined && team.squadMax !== null && team.squadFilled >= team.squadMax;
  // An offline season never gets owner invites — no auction is created in the
  // app — so "Owner — invited once the auction exists" would wait forever.
  const steps = setupSteps(team, captain, icons, auctionExists, view.viewer.canManageTeams).filter(
    (step) => view.auctionSource !== "imported" || step.key !== "owner",
  );
  // What can be done now: the coach and icons are optional, and the owner
  // waits for the auction.
  const stillToSet = steps.filter(
    (step) =>
      !step.done &&
      step.key !== "coach" &&
      step.key !== "icon" &&
      (step.key !== "owner" || auctionExists),
  );
  const href = `/seasons/${slug}/teams?team=${team.id}`;
  const unitWord = useMoneyUnit() === "points" ? "points" : "prices";
  const bought =
    view.handEntry === "open" && roster !== undefined
      ? roster.filter((row) => !row.isCaptain && !row.isIcon && !row.isRetained)
      : null;
  const handBought =
    bought === null
      ? null
      : {
          count: bought.length,
          unpriced: bought.filter((row) => (row.handPrice ?? null) === null).length,
        };
  return (
    <article
      className="team-card tm-card"
      style={teamPaint(team.color)}
      data-own={own ? "true" : undefined}
    >
      <div className="tm-card-top">
        <Crest team={team} size="md" />
        <div className="tm-card-id">
          <span className="tm-card-name">
            {team.name}
            {team.shortName !== null ? (
              <span className="tm-card-short">{team.shortName}</span>
            ) : null}
          </span>
          {started ? (
            <span className="tm-card-owner">
              {own ? <span className="tm-card-yours">Your team · </span> : null}
              {/* "Your team" already says whose — the name alone fits (census 19). */}
              {team.ownerName !== null
                ? own
                  ? team.ownerName
                  : `Owner · ${team.ownerName}`
                : "No owner"}
            </span>
          ) : handBought !== null ? (
            // Typing results in: what this team still needs is its buys and
            // their points, not "Ready for auction night".
            <span
              className="tm-card-state"
              data-done={handBought.count > 0 && handBought.unpriced === 0 ? "" : undefined}
              data-testid={`hand-progress-${team.id}`}
            >
              {own ? <span className="tm-card-yours">Your team · </span> : null}
              {handBought.count === 0
                ? "Add who it bought"
                : handBought.unpriced === 0
                  ? `${String(handBought.count)} bought · all ${unitWord} in`
                  : `${String(handBought.count)} bought · ${String(handBought.unpriced)} without ${unitWord}`}
            </span>
          ) : (
            <span className="tm-card-state" data-done={stillToSet.length === 0 ? "" : undefined}>
              {own ? <span className="tm-card-yours">Your team · </span> : null}
              {stillToSet.length === 0
                ? auctionExists
                  ? "Ready for auction night"
                  : "Captain named"
                : `${stillToSet.map((step) => step.key).join(" and ")} to set`.replace(
                    /^./,
                    (first) => first.toUpperCase(),
                  )}
            </span>
          )}
        </div>
        {started || team.squadFilled > 0 ? (
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
        ) : null}
        {/* DA-43: the card IS the target (SC 2.5.8). The link's ::after covers
            the whole card; its name stays "View team" for assistive tech. */}
        <Link
          href={href}
          className="tm-card-go team-card-cover"
          data-testid={`open-roster-${team.id}`}
        >
          <VisuallyHidden>View team</VisuallyHidden>
          <IconArrowRight size={18} aria-hidden />
        </Link>
      </div>

      {started ? (
        <>
          {roster !== undefined && roster.length > 0 ? (
            <div className="tm-card-people">
              <span className="tm-face-stack" aria-hidden>
                {roster.slice(0, 5).map((row) => (
                  <PlayerImage
                    key={row.registrationId}
                    name={row.name ?? "Player"}
                    seed={row.registrationId}
                    src={row.photoUrl}
                    size="sm"
                    shape="round"
                    decorative
                  />
                ))}
                {roster.length > 5 ? (
                  <span className="tm-face-more">+{roster.length - 5}</span>
                ) : null}
              </span>
              <span className="tm-card-staff">
                <span>
                  {captain !== null ? (
                    <>
                      <b className="tm-cap-mark" aria-hidden>
                        C
                      </b>
                      <VisuallyHidden>Captain </VisuallyHidden>
                      {captain.name ?? "Unnamed"}
                    </>
                  ) : (
                    <span className="tm-quiet">No captain named</span>
                  )}
                </span>
                {icons.length > 0 ? (
                  <span>Icon · {icons.map((icon) => icon.name ?? "Unnamed").join(", ")}</span>
                ) : null}
                <span className={team.coachName === null ? "tm-quiet" : undefined}>
                  {team.coachName !== null ? `Coach · ${team.coachName}` : "No coach named"}
                </span>
              </span>
            </div>
          ) : null}
          {roster !== undefined ? <RoleMixBar shares={roleMix(roster, view.roles)} /> : null}
          <PurseLine team={team} />
          {team.topBuyName !== undefined && team.topBuyName !== null ? (
            <p className="tm-topbuy">
              <IconTrophy size={16} className="tm-topbuy-icon" aria-hidden />
              <span className="tm-topbuy-label">Top buy</span>
              <span className="tm-topbuy-name">{team.topBuyName}</span>
              {team.topBuyPrice !== undefined && team.topBuyPrice !== null ? (
                <span className="tm-num tm-topbuy-price">{money.exact(team.topBuyPrice)}</span>
              ) : null}
            </p>
          ) : null}
        </>
      ) : (
        <ul className="tm-steps" aria-label={`${team.name}: before the auction`}>
          {steps.map((step) => (
            <li key={step.key} data-done={step.done ? "" : undefined}>
              <span className="tm-step-mark" aria-hidden>
                {step.done ? <IconCheck size={12} /> : null}
              </span>
              <span className="tm-step-label">
                {step.label}
                <VisuallyHidden>{step.done ? " — done" : " — not set"}</VisuallyHidden>
              </span>
              {step.action !== null ? (
                <Link className="tm-step-go" href={`${href}${step.action.hash}`}>
                  {step.action.label}
                  <VisuallyHidden> {step.key}</VisuallyHidden>
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
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
  const money = useMoney();
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
  const slotsOpen =
    team.squadMax !== undefined && team.squadMax !== null
      ? Math.max(0, team.squadMax - team.squadFilled)
      : null;
  // `?? []` mints a new array whenever a team carries no roster, so the role mix
  // below recomputed on every render of a squad page that had nothing to tally.
  const roster = useMemo(() => team.roster ?? [], [team.roster]);

  // The squad by playing role, in the season pack's order (the pack decides).
  const mix = useMemo(() => roleMix(roster, view.roles), [roster, view.roles]);
  const signed = useMemo(() => preSigned(roster), [roster]);
  const captain = captainOf(roster);
  const locked = view.rulesSource?.locked ?? false;

  const handCard =
    view.handEntry === "open" && view.viewer.canSeeRoster ? (
      <SectionCard
        className="tm-hand-card"
        icon={<IconGavel />}
        title="Bought in auction"
        description={
          view.auctionSource === "imported"
            ? "Search each player this team bought and type the points they went for — Enter moves to the next. Points are optional."
            : "Auction held outside the app? Add who this team bought — points are optional."
        }
      >
        <BoughtByHand
          slug={slug}
          teamId={team.id}
          teamName={team.name}
          teamColor={team.color}
          roster={roster}
        />
      </SectionCard>
    ) : null;
  // A season run offline is here to type results in: that card leads, above
  // the captain and icon picks.
  const handFirst = view.auctionSource === "imported";

  const squadSection = (
    <div className="tm-squad-tab">
      {handFirst ? handCard : null}
      {canManage && view.viewer.canSeeRoster ? (
        locked ? (
          /* After the lock the icons and retained are a record, not a form:
             one line, with the captain (still changeable) behind "Change". */
          <details className="tm-presigned" data-testid="presigned-line">
            <summary>
              <IconCrown size={18} className="tm-presigned-icon" aria-hidden />
              <span className="tm-presigned-title">Pre-signed</span>
              <span className="tm-presigned-list">
                {signed.length === 0 ? (
                  <span className="tm-quiet">Nobody — every player was bought</span>
                ) : (
                  signed.map((row) => (
                    <span key={row.registrationId} className="tm-presigned-person">
                      <PlayerImage
                        name={row.name ?? "Player"}
                        seed={row.registrationId}
                        src={row.photoUrl}
                        size="xs"
                        shape="round"
                        decorative
                      />
                      {row.name ?? "Unnamed"}
                      <Pill tone={row.isCaptain ? "blue" : row.isIcon ? "amber" : "purple"}>
                        {row.isCaptain ? "Captain" : row.isIcon ? "Icon" : "Retained"}
                      </Pill>
                    </span>
                  ))
                )}
              </span>
              <span className="tm-presigned-go">Change captain</span>
            </summary>
            <div className="tm-presigned-body">
              <SquadPreSign
                slug={slug}
                teamId={team.id}
                teamName={team.name}
                teamColor={team.color}
                roster={roster}
                locked
                settlesAtOpen={false}
              />
            </div>
          </details>
        ) : (
          <SectionCard
            className="tm-presign-card"
            icon={<IconCrown />}
            tone="gold"
            title="Captain, icons & retained"
            description="Named before the auction — they join this squad without being bid for."
          >
            <SquadPreSign
              slug={slug}
              teamId={team.id}
              teamName={team.name}
              teamColor={team.color}
              roster={roster}
              locked={false}
              settlesAtOpen={view.rulesSource !== null}
            />
          </SectionCard>
        )
      ) : null}

      {handFirst ? null : handCard}

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
        >
          {mix.length > 0 ? (
            <div className="tm-squad-mix">
              <RoleMixBar shares={mix} />
            </div>
          ) : null}
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
                              {/* With the price column the pre-signed word sits there;
                                  without money sight it is said here instead. */}
                              {view.viewer.canSeeMoney ? null : (
                                <>
                                  {row.isCaptain ? <Pill tone="blue">Captain</Pill> : null}
                                  {row.isIcon ? <Pill tone="amber">Icon</Pill> : null}
                                  {row.isRetained ? <Pill tone="purple">Retained</Pill> : null}
                                </>
                              )}
                            </span>
                            {/* A player always has one — `submitRegistration` refuses an
                                account with no number, because SMS is the only way a
                                season reaches them. The fallback is for the rows that
                                predate that rule, not a state the product creates. */}
                            <span className="tm-roster-phone" data-private>
                              {row.phone !== null ? formatPhone(row.phone) : "—"}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td data-label="Role">
                        {row.role === null ? (
                          "—"
                        ) : (
                          <span
                            className="tm-role"
                            data-slot={String(
                              (mix.find((share) => share.key === row.role)?.slot ?? 0) % 6,
                            )}
                          >
                            {labelOf(row.role)}
                          </span>
                        )}
                      </td>
                      {view.viewer.canSeeMoney ? (
                        <td className="tm-roster-price tm-num" data-label="Buy price">
                          {row.buyPrice !== undefined && row.buyPrice !== null ? (
                            money.exact(row.buyPrice)
                          ) : row.handPrice !== undefined && row.handPrice !== null ? (
                            money.exact(row.handPrice)
                          ) : row.isCaptain || row.isIcon || row.isRetained ? (
                            <Pill tone={row.isCaptain ? "blue" : row.isIcon ? "amber" : "purple"}>
                              {row.isCaptain ? "Captain" : row.isIcon ? "Icon" : "Retained"} ·
                              pre-signed
                            </Pill>
                          ) : (
                            "—"
                          )}
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
          <p className="tm-hero-pills">
            {team.shortName !== null ? (
              <span className="tm-card-short">{team.shortName}</span>
            ) : null}
            <Pill tone={slotsOpen === 0 ? "green" : "neutral"}>
              {slotsOpen !== null && team.squadMax !== undefined && team.squadMax !== null
                ? `${String(team.squadFilled)}/${String(team.squadMax)} squad${slotsOpen === 0 ? " · full" : ` · ${String(slotsOpen)} open`}`
                : `${String(team.squadFilled)} player${team.squadFilled === 1 ? "" : "s"}`}
            </Pill>
            {locked ? (
              <Pill tone="amber" icon={<IconLock />}>
                {view.rulesSource?.finished === true
                  ? "Locked — the auction is done"
                  : "Locked — the auction has started"}
              </Pill>
            ) : null}
          </p>
          <ul className="tm-hero-meta">
            <li>
              <IconUser size={16} aria-hidden />
              {team.ownerName !== null ? (
                <>
                  Owner <b>{team.ownerName}</b>
                </>
              ) : (
                "No owner yet"
              )}
            </li>
            {captain !== null ? (
              <li>
                <b className="tm-cap-mark" aria-hidden>
                  C
                </b>
                Captain <b>{captain.name ?? "Unnamed"}</b>
              </li>
            ) : null}
            {team.coachName !== null ? (
              <li>
                <IconFlag size={16} aria-hidden />
                Coach <b>{team.coachName}</b>
              </li>
            ) : null}
          </ul>
        </div>
        {team.spent !== undefined && team.purseTotal !== undefined && team.purseTotal > 0 ? (
          <div className="tm-hero-purse">
            <PurseLine team={team} />
            <span className="tm-hero-purse-note">
              of {money.exact(team.purseTotal)}
              {team.usedPct !== undefined && team.usedPct !== null
                ? ` · ${String(team.usedPct)}% used`
                : ""}
              {team.topBuyName !== undefined && team.topBuyName !== null ? (
                <>
                  {" "}
                  · top buy <b>{team.topBuyName}</b>
                  {team.topBuyPrice !== undefined && team.topBuyPrice !== null
                    ? ` ${money.exact(team.topBuyPrice)}`
                    : ""}
                </>
              ) : null}
            </span>
          </div>
        ) : null}
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
        placeholder="e.g. MAV"
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
          centre. This used to say the link "cannot be withdrawn once sent",
          which stopped being true when RevokeOwnerInvite shipped — and told an
          organizer who had mis-sent a bearer link that nothing could be done,
          at the one moment something could. */}
      <p className="teams-notice" data-testid="teams-owner-irrevocable">
        An owner link works once and expires in 7 days.{" "}
        <strong>Anyone holding it can accept it</strong> — if it reaches the wrong person, withdraw
        it from the auction&rsquo;s Owners &amp; paddles panel before they do.
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
