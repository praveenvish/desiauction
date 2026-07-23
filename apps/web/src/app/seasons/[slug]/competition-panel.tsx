"use client";

import { REJECTION_REASONS } from "@desiauction/core";
import { Badge, Button, Card, Field, Select, useToast } from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  advanceCompetitionAction,
  cloneCompetitionAction,
  createTeamAction,
  setCompetitionVisibilityAction,
  triageRegistrationAction,
  type CompetitionView,
} from "../../../server/competition/actions";
import { track } from "../../../lib/telemetry";

const STATUS_TONE = {
  draft: "neutral",
  setup: "info",
  registration_open: "success",
  registration_closed: "warning",
} as const;

const REG_TONE = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  waitlisted: "warning",
  withdrawn: "neutral",
} as const;

// The lifecycle rendered as one gate at a time (doc 44): the single next step.
const NEXT_STEP: Record<string, { to: string; label: string } | null> = {
  draft: { to: "setup", label: "Begin setup" },
  setup: { to: "registration_open", label: "Open registration" },
  registration_open: { to: "registration_closed", label: "Close registration" },
  registration_closed: { to: "registration_open", label: "Reopen registration" },
};

export function CompetitionPanel({ view, slug }: { view: CompetitionView; slug: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState(REJECTION_REASONS[0]);

  const step = NEXT_STEP[view.competition.status] ?? null;
  const registrationUrl =
    typeof window !== "undefined" ? `${window.location.origin}/seasons/${slug}/register` : "";

  const advance = async () => {
    if (step === null) {
      return;
    }
    setBusy(true);
    const result = await advanceCompetitionAction(
      slug,
      step.to as CompetitionView["competition"]["status"],
    );
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not advance.", tone: "danger" });
    }
  };

  const addTeam = async () => {
    setBusy(true);
    const result = await createTeamAction(slug, teamName, "", "");
    setBusy(false);
    if (result.ok) {
      setTeamName("");
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not create team.", tone: "danger" });
    }
  };

  // Retention ("run it again"): clone this competition into a fresh draft and
  // jump the organizer straight into next season's setup.
  const runItAgain = async () => {
    setBusy(true);
    const result = await cloneCompetitionAction(slug);
    setBusy(false);
    if (result.ok && result.slug !== undefined) {
      track("competition.cloned");
      toast({ title: "New draft created from this season.", tone: "success" });
      router.push(`/seasons/${result.slug}`);
    } else {
      toast({ title: result.error ?? "Could not duplicate.", tone: "danger" });
    }
  };

  // PX-5: publish/unpublish the public page (existing visibility column).
  const setVisibility = async (visibility: "private" | "public") => {
    setBusy(true);
    const result = await setCompetitionVisibilityAction(slug, visibility);
    setBusy(false);
    if (result.ok) {
      toast({
        title: visibility === "public" ? "Public page published" : "Public page unpublished",
        tone: "success",
      });
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not update.", tone: "danger" });
    }
  };

  const triage = async (
    registrationId: string,
    action: "approve" | "reject" | "waitlist",
    reason?: string,
  ) => {
    setBusy(true);
    const result = await triageRegistrationAction(slug, registrationId, action, reason);
    setBusy(false);
    if (result.ok) {
      setRejecting(null);
      router.refresh();
    } else {
      toast({ title: result.error ?? "Could not update.", tone: "danger" });
    }
  };

  return (
    <>
      <Card data-testid="lifecycle-panel">
        <div className="competition-head">
          <h2>Status</h2>
          <Badge tone={STATUS_TONE[view.competition.status]} data-testid="competition-status">
            {view.competition.status.replace(/_/g, " ")}
          </Badge>
        </div>
        {view.competition.location !== null ? (
          <p className="competition-meta">{view.competition.location}</p>
        ) : null}
        {view.viewer.canManage && step !== null ? (
          <Button onClick={() => void advance()} loading={busy} data-testid="advance-status">
            {step.label}
          </Button>
        ) : null}
        {view.competition.status === "registration_open" ? (
          <p className="registration-url" data-testid="registration-url">
            Registration link: {registrationUrl}
          </p>
        ) : null}
        <p className="competitions-hint">
          <Link href={`/seasons/${slug}/readiness`} data-testid="open-readiness">
            Review readiness
          </Link>{" "}
          — one view of every gate between here and auction night.
        </p>
        {view.viewer.canManage ? (
          <Button
            variant="ghost"
            loading={busy}
            data-testid="run-it-again"
            onClick={() => void runItAgain()}
          >
            Run it again → new season
          </Button>
        ) : null}
        <div className="visibility-row" data-testid="visibility-row">
          <Badge tone={view.competition.visibility === "public" ? "success" : "neutral"}>
            {view.competition.visibility === "public" ? "Public page live" : "Not listed publicly"}
          </Badge>
          {view.competition.visibility === "public" ? (
            <Link href={`/c/${slug}`} data-testid="open-public-page">
              View public page
            </Link>
          ) : null}
          {view.viewer.canManage ? (
            <Button
              variant="ghost"
              loading={busy}
              data-testid="toggle-visibility"
              onClick={() =>
                void setVisibility(view.competition.visibility === "public" ? "private" : "public")
              }
            >
              {view.competition.visibility === "public"
                ? "Unpublish public page"
                : "Publish public page"}
            </Button>
          ) : null}
        </div>
      </Card>

      <Card data-testid="teams-panel">
        <div className="competition-head">
          <h2>Teams</h2>
          <Link href={`/seasons/${slug}/teams`} data-testid="open-teams">
            Open team workspace
          </Link>
        </div>
        {view.teams.length === 0 ? (
          <p className="competitions-hint">No teams yet.</p>
        ) : (
          <ul className="team-list">
            {view.teams.map((team) => (
              <li key={team.id}>
                <span
                  className="team-swatch"
                  style={team.primaryColor !== null ? { background: team.primaryColor } : undefined}
                  aria-hidden="true"
                />
                <span className="team-name">{team.name}</span>
              </li>
            ))}
          </ul>
        )}
        {view.viewer.canManage ? (
          <div className="add-team-row">
            <Field
              label="Team name"
              name="teamName"
              value={teamName}
              onChange={(event) => {
                setTeamName(event.target.value);
              }}
              placeholder="Malad Mavericks"
            />
            <Button
              onClick={() => void addTeam()}
              loading={busy}
              data-testid="add-team"
              disabled={teamName.trim().length < 3}
            >
              Add team
            </Button>
          </div>
        ) : null}
      </Card>

      {view.viewer.canReview ? (
        <Card data-testid="triage-panel">
          <h2>Registrations</h2>
          {view.registrations.length === 0 ? (
            <p className="competitions-hint">No registrations yet.</p>
          ) : (
            <ul className="registration-list">
              {view.registrations.map((registration) => (
                <li key={registration.id} data-testid={`registration-${registration.personId}`}>
                  <span className="registration-name">{registration.name ?? "Unnamed"}</span>
                  <span className="registration-phone">{registration.phone}</span>
                  <Badge tone="neutral">{registration.role.replace(/_/g, " ")}</Badge>
                  <Badge tone={REG_TONE[registration.status]}>{registration.status}</Badge>
                  {registration.status === "submitted" || registration.status === "waitlisted" ? (
                    <span className="registration-actions">
                      <Button
                        size="sm"
                        onClick={() => void triage(registration.id, "approve")}
                        loading={busy}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void triage(registration.id, "waitlist")}
                        loading={busy}
                      >
                        Waitlist
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRejecting(registration.id);
                        }}
                        loading={busy}
                      >
                        Reject
                      </Button>
                    </span>
                  ) : null}
                  {rejecting === registration.id ? (
                    <span className="reject-row">
                      <Select
                        label="Reason"
                        name="reason"
                        value={rejectReason}
                        onChange={(event) => {
                          setRejectReason(event.target.value as (typeof REJECTION_REASONS)[number]);
                        }}
                      >
                        {REJECTION_REASONS.map((reason) => (
                          <option key={reason} value={reason}>
                            {reason}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        onClick={() => void triage(registration.id, "reject", rejectReason)}
                        loading={busy}
                      >
                        Confirm reject
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </>
  );
}
