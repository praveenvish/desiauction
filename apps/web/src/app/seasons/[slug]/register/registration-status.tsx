import {
  Badge,
  ButtonLink,
  Card,
  IconArrowRight,
  IconCheck,
  PlayerImage,
  type BadgeTone,
} from "@desiauction/ui";
import Link from "next/link";

import { ShareSeason } from "./share-season";
import { WithdrawRegistration } from "./withdraw-registration";

/**
 * ONE PANEL FOR "YOU'RE REGISTERED", WHEREVER IT IS SEEN.
 *
 * The moment of submission used to be one bare line, and a reload of the same
 * page showed a different card with different words — so the answer to "did
 * it work?" changed shape depending on how you asked. Both now render this:
 * the wizard hands it what it knows the instant the server says yes, and the
 * page hands it the stored row on every visit after. Presentational only (no
 * server imports), so it can sit on either side of the boundary.
 */

const STATUS_COPY: Record<
  string,
  { title: (season: string) => string; body: string; tone: BadgeTone }
> = {
  submitted: {
    title: (season) => `You're registered for ${season}`,
    body: "The organizer reviews every registration. We'll let you know when they decide — your status updates here and on Home.",
    tone: "info",
  },
  approved: {
    title: () => "You're in the player pool",
    body: "The organizer approved your registration. On auction day, team owners bid to sign you — the organizer will share when and where.",
    tone: "success",
  },
  // "The season is full" is a fact the product does not have: no capacity
  // column exists and waitlisting is manual triage for any reason — so the
  // copy says that, rather than inventing a cause the player might act on.
  waitlisted: {
    title: () => "You're on the waitlist",
    body: "The organizer has waitlisted your registration for now. They move waitlisted players into the pool as they decide.",
    tone: "warning",
  },
  rejected: {
    title: () => "Registration not approved",
    body: "The organizer decided not to approve this registration for this season.",
    tone: "danger",
  },
  withdrawn: {
    title: () => "Registration withdrawn",
    body: "You withdrew this registration. If registration is still open you can ask the organizer to reinstate it.",
    tone: "neutral",
  },
  draft: {
    title: () => "Registration in draft",
    body: "The organizer holds this registration as a draft. Reach them for the next step.",
    tone: "neutral",
  },
};

type StageState = "done" | "current" | "upcoming";

/** The three stages a registration moves through, where the status has them. */
function stagesFor(status: string): { label: string; state: StageState }[] | null {
  switch (status) {
    case "submitted":
      return [
        { label: "Registered", state: "done" },
        { label: "Organizer review", state: "current" },
        { label: "Auction day", state: "upcoming" },
      ];
    case "waitlisted":
      return [
        { label: "Registered", state: "done" },
        { label: "Waitlisted", state: "current" },
        { label: "Auction day", state: "upcoming" },
      ];
    case "approved":
      return [
        { label: "Registered", state: "done" },
        { label: "Approved", state: "done" },
        { label: "Auction day", state: "current" },
      ];
    default:
      return null;
  }
}

export interface RegistrationStatusProps {
  competitionName: string;
  slug: string;
  /** The season is published, so `/c/[slug]` and the player pages exist. */
  listed: boolean;
  status: string;
  /** The human-quotable registration number; unknown for an instant after submit. */
  number: string | null;
  name: string;
  photoUrl: string | null;
  roleLabel: string | null;
  /** Already resolved to player-facing words — never the raw column. */
  rejectionReason: string | null;
  /** Rendered by the wizard the moment the server accepted the submission. */
  justSubmitted?: boolean;
}

export function RegistrationStatus({
  competitionName,
  slug,
  listed,
  status,
  number,
  name,
  photoUrl,
  roleLabel,
  rejectionReason,
  justSubmitted = false,
}: RegistrationStatusProps) {
  const copy = STATUS_COPY[status];
  const stages = stagesFor(status);
  const facts = [roleLabel, number === null ? null : `Registration ${number}`].filter(
    (part): part is string => part !== null && part !== "",
  );
  const canWithdraw = status === "submitted" || status === "waitlisted" || status === "approved";

  return (
    <Card className="reg-status" data-testid="registration-status" elevation="floating">
      <div className="reg-status-head">
        <PlayerImage
          name={name}
          size="xl"
          shape="round"
          {...(photoUrl !== null ? { src: photoUrl } : {})}
        />
        <div className="reg-status-title">
          <Badge
            tone={copy?.tone ?? "neutral"}
            data-testid="my-registration-status"
            className="reg-status-badge"
          >
            {status}
          </Badge>
          {/* DA-31: after a submit the page kept its scroll position and the
              confirmation landed out of view. Focus moves to the heading, which
              scrolls it into view and announces it in one act. */}
          <h2
            {...(justSubmitted
              ? {
                  "data-testid": "registration-submitted",
                  tabIndex: -1,
                  ref: (node: HTMLHeadingElement | null) => {
                    if (node === null) {
                      return;
                    }
                    // The confirm step sat far down a phone screen; start the
                    // panel at the top, under the season's name, then focus.
                    window.scrollTo({ top: 0 });
                    node.focus({ preventScroll: true });
                  },
                }
              : {})}
          >
            {copy?.title(competitionName) ?? status}
          </h2>
          {facts.length > 0 ? <p className="reg-status-facts">{facts.join(" · ")}</p> : null}
        </div>
      </div>

      {stages !== null ? (
        <ol className="reg-track" aria-label="Where your registration is">
          {stages.map((stage) => (
            <li
              key={stage.label}
              className={`reg-track-step reg-track-${stage.state}`}
              aria-current={stage.state === "current" ? "step" : undefined}
            >
              <span className="reg-track-label">
                {stage.state === "done" ? <IconCheck size={14} /> : null}
                {stage.label}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="reg-status-body">{copy?.body}</p>

      {/* DA-35: the reason was captured, shipped and rendered nowhere. The
          caller resolves it to the category's player-facing words — never the
          raw column, which is the organizer's (invariant 6). */}
      {status === "rejected" && rejectionReason !== null ? (
        <p className="reg-status-body" data-testid="my-rejection-reason">
          <strong>Reason given:</strong> {rejectionReason}.
        </p>
      ) : null}

      {/* A player was never shown their own public page — the only link to it
          lived inside the public page itself. Shown here, next to the withdraw
          control that takes it down. */}
      {status === "approved" && listed && number !== null ? (
        <div className="reg-status-public" data-testid="my-public-page">
          <p className="reg-status-public-head">Your public player page is live</p>
          <p className="register-hint">
            Name, number, role, age and styles if given, your photo, and later your team — never
            your mobile number. Withdraw below to take it down.
          </p>
          <Link className="reg-status-public-url" href={`/c/${slug}/p/${number}`}>
            /c/{slug}/p/{number}
            <IconArrowRight size={14} />
          </Link>
        </div>
      ) : null}

      <div className="reg-status-actions">
        {listed ? (
          <ButtonLink href={`/c/${slug}`} size="touch" data-testid="view-season">
            View season page
          </ButtonLink>
        ) : null}
        <ButtonLink href="/home" size="touch" variant={listed ? "secondary" : "primary"}>
          Go to Home
        </ButtonLink>
        {listed ? <ShareSeason path={`/c/${slug}`} title={competitionName} /> : null}
      </div>

      {canWithdraw ? (
        <div className="reg-status-foot">
          <WithdrawRegistration slug={slug} />
        </div>
      ) : null}
    </Card>
  );
}
