"use client";

import { Badge, Button, ButtonLink, Card, EmptyState, Field, useToast } from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createTeamAction, setTeamCoachAction } from "../../../../server/competition/actions";
import type { RegistrationDashboard } from "../../../../server/competition/actions";
import { TeamLogoUploader } from "./team-logo-uploader";

type RosterRow = RegistrationDashboard["page"]["rows"][number];

export interface TeamsPanelProps {
  slug: string;
  teams: {
    id: string;
    name: string;
    shortName: string | null;
    primaryColor: string | null;
    coachName: string | null;
    logoUrl: string | null;
  }[];
  canManage: boolean;
  approvedCount: number;
  selectedTeamId: string | null;
  /** Server-rendered roster for the URL-selected team (?team=…). */
  roster: RosterRow[] | null;
}

const ROLE_LABEL: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  all_rounder: "All-rounder",
  wicket_keeper: "Wicket-keeper",
};

/**
 * PX-4 Team Workspace panel. The roster arrives server-rendered through the
 * EXISTING registration query (teamId filter) addressed by URL — no new roster
 * endpoint, no client-side rules. Readiness facts shown are the platform's
 * own (auctionReady counts these teams; the pool is approved registrations).
 */
export function TeamsPanel({
  slug,
  teams,
  canManage,
  approvedCount,
  selectedTeamId,
  roster,
}: TeamsPanelProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [color, setColor] = useState("#1f6f43");
  const [formError, setFormError] = useState<string | null>(null);

  const selected = teams.find((team) => team.id === selectedTeamId) ?? null;

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
      router.refresh();
    });
  };

  return (
    <>
      <Card data-testid="teams-workspace">
        <div className="teams-head">
          <h2>Teams</h2>
          <span className="competitions-hint" data-testid="teams-count">
            {teams.length} team{teams.length === 1 ? "" : "s"} · {approvedCount} approved player
            {approvedCount === 1 ? "" : "s"} in the pool
          </span>
        </div>
        {teams.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No teams yet"
            description="The auction needs at least two teams. Create the first one below."
          />
        ) : (
          <ul className="teams-list" data-testid="teams-list">
            {teams.map((team) => (
              <li key={team.id} className="teams-row">
                {team.logoUrl !== null ? (
                  <img
                    className="teams-crest"
                    src={team.logoUrl}
                    alt=""
                    width={28}
                    height={28}
                    loading="lazy"
                  />
                ) : (
                  <span
                    className="teams-swatch"
                    style={{ background: team.primaryColor ?? "var(--accent)" }}
                    aria-hidden
                  />
                )}
                <span className="registration-name">{team.name}</span>
                {team.shortName !== null && team.shortName !== "" ? (
                  <Badge tone="neutral">{team.shortName}</Badge>
                ) : null}
                {team.coachName !== null && team.coachName !== "" ? (
                  <span className="competitions-hint" data-testid={`team-coach-${team.id}`}>
                    Coach: {team.coachName}
                  </span>
                ) : null}
                <span className="teams-row-actions">
                  <Link
                    href={`/competitions/${slug}/teams?team=${team.id}`}
                    data-testid={`open-roster-${team.id}`}
                  >
                    View roster
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected !== null ? (
        <Card data-testid="roster-panel">
          <div className="teams-head">
            <h2>{selected.name} — roster</h2>
            <ButtonLink
              href={`/competitions/${slug}/registrations?team=${selected.id}`}
              variant="ghost"
            >
              Manage in Registrations
            </ButtonLink>
          </div>
          {canManage ? (
            <div className="teams-manage">
              <TeamLogoUploader
                slug={slug}
                teamId={selected.id}
                teamName={selected.name}
                {...(selected.logoUrl !== null ? { currentUrl: selected.logoUrl } : {})}
              />
              <CoachEditor
                key={selected.id}
                slug={slug}
                teamId={selected.id}
                initial={selected.coachName ?? ""}
              />
            </div>
          ) : null}
          {roster === null || roster.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title="No players assigned yet"
              description="Assign approved players to this team from the Registrations tab."
              action={
                <ButtonLink href={`/competitions/${slug}/registrations?status=approved`}>
                  Open registrations
                </ButtonLink>
              }
            />
          ) : (
            <ul className="teams-roster" data-testid="roster-list">
              {roster.map((row) => (
                <li key={row.id} className="teams-row">
                  <span className="reg-number">{row.number}</span>
                  <span className="registration-name">{row.name ?? row.phone}</span>
                  <Badge tone="neutral">{ROLE_LABEL[row.role] ?? row.role}</Badge>
                  <Badge tone={row.status === "approved" ? "success" : "warning"}>
                    {row.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="competitions-hint">
            Team owners are invited from the{" "}
            <Link href={`/competitions/${slug}/auction`}>Auction tab</Link> once the auction is
            created — ownership is an auction-night grant, not a roster field.
          </p>
        </Card>
      ) : null}

      {canManage ? (
        <Card data-testid="create-team-panel">
          <h2>Add a team</h2>
          <div className="teams-form">
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
            <Button onClick={addTeam} loading={pending} data-testid="add-team-workspace">
              Create team
            </Button>
          </div>
        </Card>
      ) : null}
    </>
  );
}

/** Inline coach editor for the selected team (non-bidding staff metadata). */
function CoachEditor({ slug, teamId, initial }: { slug: string; teamId: string; initial: string }) {
  const router = useRouter();
  const toast = useToast();
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
