"use client";

import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  Field,
  paintOnFill,
  useToast,
  initialsFor,
} from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { PageTitle } from "../../../../components/shell/page-title";
import {
  createTeamAction,
  exportRegistrationsAction,
  setTeamCoachAction,
  updateTeamAction,
} from "../../../../server/competition/actions";
import type { TeamCard, TeamsWorkspaceView } from "../../../../server/competition/actions";
import { inviteOwnerAction } from "../../../../server/auction/owner-actions";
import { TeamLogoUploader } from "./team-logo-uploader";

const ROLE_LABEL: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  all_rounder: "All rounder",
  wicket_keeper: "Wicket-keeper",
};

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.replace(/_/g, " ");
}

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

/** Distinguishable on a projector, and legible under the board's dark theme. */
const TEAM_PALETTE = [
  "#1f6f43",
  "#1d4e89",
  "#8e2420",
  "#6b3fa0",
  "#a8620f",
  "#0f6d75",
  "#8a1c53",
  "#4a5a2b",
];

/**
 * DA-20/DA-37: the next shade nobody has taken, and — once all eight are taken —
 * the least-used one rather than always the first.
 *
 * DA-20 moved this bug one shade over instead of removing it: the colour was
 * computed in a `useState` INITIALISER, so it was fixed at mount and never
 * re-rolled as teams were added. Twelve teams created through this dialog took
 * the same shade. It is now recomputed every time the dialog opens.
 */
function nextTeamColor(teams: readonly { color: string | null }[]): string {
  const used = new Map<string, number>(TEAM_PALETTE.map((shade) => [shade, 0]));
  for (const team of teams) {
    const shade = team.color?.toLowerCase() ?? "";
    if (used.has(shade)) {
      used.set(shade, (used.get(shade) ?? 0) + 1);
    }
  }
  let best = TEAM_PALETTE[0] ?? "#1f6f43";
  let bestCount = Number.POSITIVE_INFINITY;
  for (const shade of TEAM_PALETTE) {
    const count = used.get(shade) ?? 0;
    if (count < bestCount) {
      best = shade;
      bestCount = count;
    }
  }
  return best;
}

function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [color, setColor] = useState(() => nextTeamColor(view.teams));
  const [formError, setFormError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const locked = view.rulesSource?.locked ?? false;
  const canAdd = view.viewer.canManageTeams && !locked;

  const openAdd = () => {
    setFormError(null);
    setColor(nextTeamColor(view.teams));
    setAddOpen(true);
  };

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return view.teams;
    return view.teams.filter(
      (team) =>
        team.name.toLowerCase().includes(needle) ||
        (team.shortName ?? "").toLowerCase().includes(needle),
    );
  }, [query, view.teams]);

  const addTeam = () => {
    setFormError(null);
    startTransition(async () => {
      const result = await createTeamAction(slug, name, shortName, color);
      if (!result.ok) {
        setFormError(result.error ?? "That team couldn't be created.");
        // DA-38: a failed submit used to leave focus on <body>, so a keyboard or
        // screen-reader user landed nowhere and never heard the error.
        nameRef.current?.focus();
        return;
      }
      toast({ tone: "success", title: "Team created" });
      setName("");
      setShortName("");
      setAddOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <header className="teams-page-head">
        <div>
          <p className="teams-page-sub" data-testid="teams-count">
            {view.teams.length} team{view.teams.length === 1 ? "" : "s"} · {view.approvedPlayers}{" "}
            approved player{view.approvedPlayers === 1 ? "" : "s"}
          </p>
          {/* DA-39: the purse figure used to appear with no provenance — no link
              to where it was set, no lock indicator — and vanished entirely while
              the decision was still open. It is a default an organizer accepted
              in "Rules of the night", so it says so and links there. */}
          {view.purseTotal !== undefined ? (
            <p className="teams-provenance" data-testid="purse-provenance">
              {view.purseTotal > 0 ? (
                <>
                  Purse {compactINR(view.purseTotal)} per team
                  {view.squadMax !== undefined && view.squadMax !== null
                    ? `, squad of ${String(view.squadMax)}`
                    : ""}{" "}
                  — {locked ? "locked when the auction started" : "set in"}{" "}
                  <Link href={`/seasons/${slug}/auction`}>Rules of the night</Link>.
                </>
              ) : (
                <>
                  No purse is set yet. It is chosen in{" "}
                  <Link href={`/seasons/${slug}/auction`}>Rules of the night</Link> when the auction
                  is created.
                </>
              )}
            </p>
          ) : null}
        </div>
        {view.viewer.canManageTeams ? (
          <Button data-testid="open-add-team" onClick={openAdd} disabled={locked}>
            + Add team
          </Button>
        ) : null}
      </header>

      {/* DA-40: the auction lock is season state, not a validation failure on a
          text input. It is now stated before the form, not after the submit. */}
      {locked && view.viewer.canManageTeams ? (
        <p className="teams-notice" role="status" data-testid="teams-locked-notice">
          The auction has started, so the team list is locked for this season. Teams stay editable
          until you go live.
        </p>
      ) : null}

      {/* DA-41: this screen says "add the teams that will bid" and had no concept
          of the person who bids — every link led to Registrations or back here.
          It now names the real order and links to the step that unblocks it. */}
      {view.viewer.canManageTeams && view.rulesSource === null && view.teams.length > 0 ? (
        <p className="teams-notice" data-testid="teams-owner-hint">
          Next: <Link href={`/seasons/${slug}/auction`}>create the auction</Link>, then invite an
          owner for each team from its card here. You can keep adding teams until the auction goes
          live.
        </p>
      ) : null}

      {view.teams.length > 0 ? (
        <div className="teams-toolbar">
          <input
            type="search"
            className="teams-search"
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
        <Card>
          <EmptyState
            headingLevel={2}
            title="No teams yet"
            description="The auction needs at least two teams. Add the first one to get going."
            {...(canAdd
              ? {
                  action: (
                    <Button data-testid="open-add-team-empty" onClick={openAdd}>
                      + Add team
                    </Button>
                  ),
                }
              : {})}
          />
        </Card>
      ) : (
        <ul className="team-grid" data-testid="teams-list">
          {shown.map((team) => (
            <li key={team.id}>
              <TeamGridCard team={team} slug={slug} view={view} />
            </li>
          ))}
          {shown.length === 0 ? <li className="teams-empty">No teams match “{query}”.</li> : null}
        </ul>
      )}

      <Dialog
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
        }}
        title="Add a team"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAddOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={addTeam} loading={pending} data-testid="add-team-workspace">
              Create team
            </Button>
          </>
        }
      >
        <div className="teams-dialog-form">
          <Field
            ref={nameRef}
            label="Team name"
            name="team-name"
            placeholder="Malad Mavericks"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            {...(formError !== null ? { error: formError } : {})}
          />
          <div className="teams-dialog-row">
            <Field
              label="Short name"
              name="team-short"
              placeholder="MAV"
              value={shortName}
              onChange={(event) => {
                setShortName(event.target.value);
              }}
            />
            <Field
              label="Colour"
              name="team-color"
              type="color"
              value={color}
              onChange={(event) => {
                setColor(event.target.value);
              }}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}

function TeamGridCard({
  team,
  slug,
  view,
}: {
  team: TeamCard;
  slug: string;
  view: TeamsWorkspaceView;
}) {
  const remaining =
    team.purseTotal !== undefined && team.spent !== undefined
      ? Math.max(0, team.purseTotal - team.spent)
      : null;
  return (
    <article className="team-card">
      <div className="team-card-top">
        {team.logoUrl !== null ? (
          <img className="teams-crest" src={team.logoUrl} alt="" width={40} height={40} />
        ) : (
          <span className="team-card-mono" style={paintOnFill(team.color)} aria-hidden>
            {monogram(team)}
          </span>
        )}
        <div className="team-card-id">
          <span className="team-card-name">
            {team.name}
            {team.shortName !== null ? (
              <span className="team-card-short">{team.shortName}</span>
            ) : null}
          </span>
          {/* DA-42: the coach was saved, toasted and stored, and then rendered
              on no screen in the product. */}
          <span className="team-card-owner">
            {team.ownerName !== null ? `Owner · ${team.ownerName}` : "No owner yet"}
            {team.coachName !== null ? ` · Coach · ${team.coachName}` : ""}
          </span>
        </div>
        {team.squadMax !== undefined && team.squadMax !== null ? (
          <span className="team-card-squad">
            {team.squadFilled}/{team.squadMax}
          </span>
        ) : (
          <span className="team-card-squad">{team.squadFilled}</span>
        )}
      </div>

      {team.usedPct !== undefined && team.usedPct !== null ? (
        <div className="team-card-purse">
          <div className="team-card-purse-head">
            <span>Purse used</span>
            <span>{team.usedPct}%</span>
          </div>
          <span className="season-bar" aria-hidden>
            <span
              className="season-bar-fill"
              style={{
                width: `${String(Math.min(100, team.usedPct))}%`,
                ...(team.color !== null ? { background: team.color } : {}),
              }}
            />
          </span>
        </div>
      ) : null}

      {team.spent !== undefined ? (
        <div className="team-card-money">
          <div>
            <span className="team-card-money-lbl">Spent</span>
            <span className="team-card-money-val">{exactINR(team.spent)}</span>
          </div>
          <div>
            <span className="team-card-money-lbl">Remaining</span>
            <span className="team-card-money-val is-positive">
              {/* DA-24: no auction yet means no purse yet — "₹0" read as broke. */}
              {remaining !== null && (team.purseTotal ?? 0) > 0 ? exactINR(remaining) : "—"}
            </span>
          </div>
        </div>
      ) : null}

      <div className="team-card-foot">
        {team.topBuyName !== undefined ? (
          team.topBuyName !== null ? (
            <span className="team-card-topbuy">Top buy · {team.topBuyName}</span>
          ) : (
            <span className="team-card-topbuy team-card-topbuy-empty">No buys yet</span>
          )
        ) : (
          <span className="team-card-topbuy team-card-topbuy-empty">
            {team.squadFilled} squad {team.squadFilled === 1 ? "member" : "members"}
          </span>
        )}
        {/* DA-43: "Prepare roster →" was a 100×16 hit area on a card that was
            2.3% clickable — below SC 2.5.8 AA. The link's ::after now covers the
            whole card, so the target is the card and the accessible name is
            still the link's own text. */}
        <Link
          href={`/seasons/${slug}/teams?team=${team.id}`}
          className="team-card-link team-card-cover"
          data-testid={`open-roster-${team.id}`}
        >
          {view.viewer.canSeeRoster ? "Prepare roster →" : "Open team →"}
        </Link>
      </div>
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
  const toast = useToast();
  const [exporting, startExport] = useTransition();
  const canManage = view.viewer.canManageTeams;
  const remaining =
    team.purseTotal !== undefined && team.spent !== undefined
      ? Math.max(0, team.purseTotal - team.spent)
      : null;
  const slotsOpen =
    team.squadMax !== undefined && team.squadMax !== null
      ? Math.max(0, team.squadMax - team.squadFilled)
      : null;
  const roster = team.roster ?? [];

  // The per-role tally chips, in the design's fixed order.
  const tally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of roster) {
      counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
    }
    const order = ["batter", "bowler", "all_rounder", "wicket_keeper"];
    return [...counts.entries()].sort(
      (a, b) => order.indexOf(a[0]) + 100 - (order.indexOf(b[0]) + 100),
    );
  }, [roster]);

  return (
    <>
      <Link href={`/seasons/${slug}/teams`} className="teams-back">
        ← All teams
      </Link>

      <header className="team-detail-head">
        {team.logoUrl !== null ? (
          <img className="teams-crest lg" src={team.logoUrl} alt="" width={52} height={52} />
        ) : (
          <span className="team-card-mono lg" style={paintOnFill(team.color)} aria-hidden>
            {monogram(team)}
          </span>
        )}
        <div className="team-detail-id">
          {/* Selecting a team is a URL state of the Teams surface, so the
              shell's title follows it rather than the page growing a second. */}
          <PageTitle title={team.name} />
          <p className="team-detail-sub">
            {team.shortName !== null ? `${team.shortName} · ` : ""}
            {team.ownerName !== null ? `Owner · ${team.ownerName} · ` : "No owner yet · "}
            {team.coachName !== null ? `Coach · ${team.coachName} · ` : ""}
            {slotsOpen !== null && team.squadMax !== undefined && team.squadMax !== null
              ? `${String(team.squadFilled)}/${String(team.squadMax)} squad · ${String(slotsOpen)} slot${slotsOpen === 1 ? "" : "s"} open`
              : `${String(team.squadFilled)} player${team.squadFilled === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="team-detail-actions">
          {view.viewer.canSeeRoster ? (
            <Button
              variant="secondary"
              size="sm"
              loading={exporting}
              data-testid="export-squad"
              onClick={() => {
                startExport(async () => {
                  // DA-34: "Export" used to NAVIGATE to a filtered list. This
                  // downloads the squad, which is what the word means.
                  const result = await exportRegistrationsAction(slug, team.id);
                  if (!result.ok) {
                    toast({ tone: "danger", title: result.error });
                    return;
                  }
                  downloadCsv(result.csv, result.filename);
                  toast({ tone: "success", title: "Squad exported" });
                });
              }}
            >
              Export squad CSV
            </Button>
          ) : null}
          {canManage ? (
            <ButtonLink href={`/seasons/${slug}/registrations?status=approved`} size="sm">
              + Add to roster
            </ButtonLink>
          ) : null}
        </div>
      </header>

      {team.spent !== undefined ? (
        <div className="team-detail-tiles">
          <div className="season-tile">
            <span className="season-tile-value">{exactINR(team.spent)}</span>
            <span className="season-tile-label">Purse spent</span>
          </div>
          <div className="season-tile">
            <span className="season-tile-value season-tile-accent">
              {remaining !== null && (team.purseTotal ?? 0) > 0 ? exactINR(remaining) : "—"}
            </span>
            <span className="season-tile-label">Remaining</span>
          </div>
          <div className="season-tile">
            <span className="season-tile-value">
              {team.usedPct !== undefined && team.usedPct !== null
                ? `${String(team.usedPct)}%`
                : "—"}
            </span>
            <span className="season-tile-label">Purse used</span>
          </div>
          <div className="season-tile">
            <span className="season-tile-value team-tile-name">{team.topBuyName ?? "—"}</span>
            <span className="season-tile-label">Top buy</span>
          </div>
        </div>
      ) : null}

      {tally.length > 0 ? (
        <div className="team-tally">
          {tally.map(([role, count]) => (
            <span key={role} className="team-tally-chip">
              {roleLabel(role)} <b>{count}</b>
            </span>
          ))}
        </div>
      ) : null}

      {view.viewer.canSeeRoster ? (
        <Card>
          {roster.length === 0 ? (
            <EmptyState
              headingLevel={2}
              title="No players on this squad yet"
              description="Players land here when they're won at auction or assigned from Registrations."
              action={
                <ButtonLink href={`/seasons/${slug}/registrations?status=approved`}>
                  Open registrations
                </ButtonLink>
              }
            />
          ) : (
            <div className="table-scroll">
              <table className="roster-table" data-testid="roster-list">
                <thead>
                  <tr>
                    <th className="roster-num">#</th>
                    <th>Player</th>
                    <th>Role</th>
                    {view.viewer.canSeeMoney ? <th className="roster-price">Buy price</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((row, index) => (
                    <tr key={row.registrationId}>
                      <td className="roster-num">{String(index + 1).padStart(2, "0")}</td>
                      <td>
                        <span className="roster-player">
                          <span className="roster-avatar" aria-hidden>
                            {/* DA-23: the roster took the first TWO LETTERS of the first word,
                                so Arjun Sharma read "AR" here and "AS" on Registrations. */}
                            {initialsFor(row.name ?? row.phone).initials ?? "?"}
                          </span>
                          <span className="roster-person">
                            <span className="roster-name">
                              {row.name ?? "Unnamed"}
                              {row.isCaptain ? <Badge tone="info">Captain</Badge> : null}
                              {row.isIcon ? <Badge tone="success">Icon</Badge> : null}
                            </span>
                            <span className="roster-phone">{row.phone}</span>
                          </span>
                        </span>
                      </td>
                      <td>{roleLabel(row.role)}</td>
                      {view.viewer.canSeeMoney ? (
                        <td className="roster-price">
                          {row.buyPrice !== undefined && row.buyPrice !== null
                            ? exactINR(row.buyPrice)
                            : "—"}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <EmptyState
            headingLevel={2}
            title="The squad is not yours to see"
            description="Reviewing this season's players needs the registration-review permission. Ask an organizer of this season for it."
          />
        </Card>
      )}

      {canManage ? (
        <Card>
          <h2 className="team-settings-title">Team settings</h2>
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
              />
            </div>
          </div>
        </Card>
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
}: {
  slug: string;
  teamId: string;
  ownerName: string | null;
  canConduct: boolean;
  auctionExists: boolean;
}) {
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
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
  return (
    <div className="teams-settings-forms" data-testid="owner-invite">
      <p className="teams-form-label">
        {ownerName !== null ? `Owner · ${ownerName}` : "This team has no owner yet."}
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
            setUrl(`${window.location.origin}${result.joinPath}`);
            toast({ tone: "success", title: "Invitation link ready — send it to the owner." });
          });
        }}
      >
        {ownerName !== null ? "Invite another owner" : "Invite owner"}
      </Button>
      {url !== null ? (
        <p className="teams-invite-url" data-testid="teams-owner-invite-url">
          {url}
        </p>
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
