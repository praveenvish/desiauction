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
import { useMemo, useState, useTransition } from "react";

import { PageTitle } from "../../../../components/shell/page-title";
import { createTeamAction, setTeamCoachAction } from "../../../../server/competition/actions";
import type { TeamCard, TeamsWorkspaceView } from "../../../../server/competition/actions";
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

function monogram(team: { shortName: string | null; name: string }): string {
  return (team.shortName ?? team.name).slice(0, 3).toUpperCase();
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

function nextTeamColor(teams: readonly { color: string | null }[]): string {
  const taken = new Set(teams.map((team) => team.color?.toLowerCase() ?? ""));
  return TEAM_PALETTE.find((shade) => !taken.has(shade)) ?? TEAM_PALETTE[0] ?? "#1f6f43";
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
    return <RosterDetail slug={slug} team={selected} canManage={view.viewer.canManage} />;
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
  // DA-20: every team created through the dialog took the same green, and team
  // colour is the auction board's primary way of telling four teams apart. The
  // next unused shade is offered by default; the picker still overrides it.
  const [color, setColor] = useState(nextTeamColor(view.teams));
  const [formError, setFormError] = useState<string | null>(null);

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
            {view.purseTotal > 0 ? ` · purse ${compactINR(view.purseTotal)} each` : ""}
          </p>
        </div>
        {view.viewer.canManage ? (
          <Button
            data-testid="open-add-team"
            onClick={() => {
              setFormError(null);
              setAddOpen(true);
            }}
          >
            + Add team
          </Button>
        ) : null}
      </header>

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
            {...(view.viewer.canManage
              ? {
                  action: (
                    <Button
                      data-testid="open-add-team-empty"
                      onClick={() => {
                        setFormError(null);
                        setAddOpen(true);
                      }}
                    >
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
              <TeamGridCard team={team} slug={slug} />
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

function TeamGridCard({ team, slug }: { team: TeamCard; slug: string }) {
  const remaining = Math.max(0, team.purseTotal - team.spent);
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
          <span className="team-card-name">{team.name}</span>
          {team.ownerName !== null ? (
            <span className="team-card-owner">Owner · {team.ownerName}</span>
          ) : null}
        </div>
        {team.squadMax !== null ? (
          <span className="team-card-squad">
            {team.squadFilled}/{team.squadMax}
          </span>
        ) : null}
      </div>

      {team.usedPct !== null ? (
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

      <div className="team-card-money">
        <div>
          <span className="team-card-money-lbl">Spent</span>
          <span className="team-card-money-val">{exactINR(team.spent)}</span>
        </div>
        <div>
          <span className="team-card-money-lbl">Remaining</span>
          <span className="team-card-money-val is-positive">
            {/* DA-24: no auction yet means no purse yet — "₹0" read as broke. */}
            {team.purseTotal > 0 ? exactINR(remaining) : "—"}
          </span>
        </div>
      </div>

      <div className="team-card-foot">
        {team.topBuyName !== null ? (
          <span className="team-card-topbuy">Top buy · {team.topBuyName}</span>
        ) : (
          <span className="team-card-topbuy team-card-topbuy-empty">No buys yet</span>
        )}
        <Link
          href={`/seasons/${slug}/teams?team=${team.id}`}
          className="team-card-link"
          data-testid={`open-roster-${team.id}`}
        >
          Prepare roster →
        </Link>
      </div>
    </article>
  );
}

/* --- One team's roster ----------------------------------------------------- */

function RosterDetail({
  slug,
  team,
  canManage,
}: {
  slug: string;
  team: TeamCard;
  canManage: boolean;
}) {
  const remaining = Math.max(0, team.purseTotal - team.spent);
  const slotsOpen = team.squadMax !== null ? Math.max(0, team.squadMax - team.squadFilled) : null;

  // The per-role tally chips, in the design's fixed order.
  const tally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of team.roster) {
      counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
    }
    const order = ["batter", "bowler", "all_rounder", "wicket_keeper"];
    return [...counts.entries()].sort(
      (a, b) => order.indexOf(a[0]) + 100 - (order.indexOf(b[0]) + 100),
    );
  }, [team.roster]);

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
            {team.ownerName !== null ? `Owner · ${team.ownerName} · ` : ""}
            {team.squadMax !== null
              ? `${String(team.squadFilled)}/${String(team.squadMax)} squad${slotsOpen !== null ? ` · ${String(slotsOpen)} slot${slotsOpen === 1 ? "" : "s"} open` : ""}`
              : `${String(team.squadFilled)} player${team.squadFilled === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="team-detail-actions">
          <ButtonLink
            href={`/seasons/${slug}/registrations?team=${team.id}`}
            variant="secondary"
            size="sm"
          >
            Export
          </ButtonLink>
          {canManage ? (
            <ButtonLink href={`/seasons/${slug}/registrations?status=approved`} size="sm">
              + Add to roster
            </ButtonLink>
          ) : null}
        </div>
      </header>

      <div className="team-detail-tiles">
        <div className="season-tile">
          <span className="season-tile-value">{exactINR(team.spent)}</span>
          <span className="season-tile-label">Purse spent</span>
        </div>
        <div className="season-tile">
          <span className="season-tile-value season-tile-accent">
            {team.purseTotal > 0 ? exactINR(remaining) : "—"}
          </span>
          <span className="season-tile-label">Remaining</span>
        </div>
        <div className="season-tile">
          <span className="season-tile-value">
            {team.usedPct !== null ? `${String(team.usedPct)}%` : "—"}
          </span>
          <span className="season-tile-label">Purse used</span>
        </div>
        <div className="season-tile">
          <span className="season-tile-value team-tile-name">{team.topBuyName ?? "—"}</span>
          <span className="season-tile-label">Top buy</span>
        </div>
      </div>

      {tally.length > 0 ? (
        <div className="team-tally">
          {tally.map(([role, count]) => (
            <span key={role} className="team-tally-chip">
              {roleLabel(role)} <b>{count}</b>
            </span>
          ))}
        </div>
      ) : null}

      <Card>
        {team.roster.length === 0 ? (
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
                  <th className="roster-price">Buy price</th>
                </tr>
              </thead>
              <tbody>
                {team.roster.map((row, index) => (
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
                    <td className="roster-price">
                      {row.buyPrice !== null ? exactINR(row.buyPrice) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
            <CoachEditor slug={slug} teamId={team.id} />
          </div>
        </Card>
      ) : null}
    </>
  );
}

/** Inline coach editor for the selected team (non-bidding staff metadata). */
function CoachEditor({ slug, teamId }: { slug: string; teamId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [coach, setCoach] = useState("");
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
