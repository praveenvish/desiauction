"use client";

import {
  isBattingStyle,
  isBowlingStyle,
  BATTING_STYLES,
  BOWLING_STYLES,
  REGISTRATION_ROLES,
  battingStyleLabel,
  bowlingStyleLabel,
} from "@desiauction/core";
import { Badge, Button, Card, Field, Select } from "@desiauction/ui";
import { useEffect, useState, useTransition } from "react";

import { formatPhone } from "../../../../lib/format-phone";
import { track } from "../../../../lib/telemetry";
import { updateProfileAction } from "../../../../server/auth/actions";
import { submitRegistrationAction } from "../../../../server/competition/actions";
import { SelfPhotoUploader } from "./self-photo-uploader";

const ROLE_LABEL: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  all_rounder: "All-rounder",
  wicket_keeper: "Wicket-keeper",
};

type Step = "profile" | "role" | "review";

const draftKey = (slug: string) => `da:reg-draft:${slug}`;

/**
 * DA-35: the draft persisted ONE of the four answers step 2 collects. Date of
 * birth and both playing styles were dropped on any refresh — and because the
 * review omits blank rows by design, the loss was presented as a completed
 * form. The draft is now the whole step.
 */
interface Draft {
  role: string;
  dob: string;
  batting: string;
  bowling: string;
}

function readDraft(slug: string): Draft | null {
  const saved = window.localStorage.getItem(draftKey(slug));
  if (saved === null || saved === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Partial<Draft>;
      return {
        role: typeof record.role === "string" ? record.role : "",
        dob: typeof record.dob === "string" ? record.dob : "",
        batting: typeof record.batting === "string" ? record.batting : "",
        bowling: typeof record.bowling === "string" ? record.bowling : "",
      };
    }
  } catch {
    // Drafts written before this shape were a bare role string.
  }
  return { role: saved, dob: "", batting: "", bowling: "" };
}

/**
 * Three steps, two truths: the name persists to people.name the moment step 1
 * completes (server truth — a browser restart resumes at step 2), and the role
 * choice autosaves device-locally until submission creates the registration
 * row. All validation is the server's; errors render verbatim.
 */
export function RegisterFlow({
  slug,
  competitionName,
  phone,
  initialName,
  source,
}: {
  slug: string;
  competitionName: string;
  phone: string;
  initialName: string;
  /** Share-attribution `?ref` from the landing URL; "" when direct. */
  source: string;
}) {
  const [name, setName] = useState(initialName);
  const [nameDone, setNameDone] = useState(initialName.trim() !== "");
  const [role, setRole] = useState("");
  // Optional player profile (parity §3.2). Not gated — a bare role still submits.
  const [dob, setDob] = useState("");
  const [batting, setBatting] = useState("");
  const [bowling, setBowling] = useState("");
  const [step, setStep] = useState<Step>(nameDone ? "role" : "profile");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const [restored, setRestored] = useState(false);

  // Draft recovery: restore EVERY saved answer and resume at review after a
  // refresh or a browser restart. The review below now shows all four, so
  // landing there is a chance to check them, not a way to hide what was lost.
  useEffect(() => {
    const saved = readDraft(slug);
    if (saved !== null) {
      setRole(saved.role);
      setDob(saved.dob);
      setBatting(saved.batting);
      setBowling(saved.bowling);
      if (initialName.trim() !== "") {
        setStep("review");
        setRestored(true);
      }
    }
  }, [slug, initialName]);

  const saveDraft = (next: Partial<Draft>) => {
    const current = readDraft(slug) ?? { role, dob, batting, bowling };
    window.localStorage.setItem(draftKey(slug), JSON.stringify({ ...current, ...next }));
  };

  const saveName = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await updateProfileAction({}, formData);
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      const value = (formData.get("name") as string | null) ?? "";
      setName(value.trim().replace(/\s+/g, " "));
      setNameDone(true);
      track("profile.completed");
      setStep("role");
    });
  };

  const chooseRole = (value: string) => {
    setRole(value);
    // Autosave the draft the moment it changes.
    saveDraft({ role: value });
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("role", role);
      if (dob !== "") {
        formData.set("dateOfBirth", dob);
      }
      if (batting !== "") {
        formData.set("battingStyle", batting);
      }
      if (bowling !== "") {
        formData.set("bowlingStyle", bowling);
      }
      if (source !== "") {
        formData.set("source", source);
      }
      const result = await submitRegistrationAction(slug, {}, formData);
      if (result.done === true) {
        window.localStorage.removeItem(draftKey(slug));
        setDone(true);
      } else {
        setError(result.error ?? "That didn't save. Try again.");
        // A duplicate means truth moved on another device — show the status.
        if (result.error?.includes("already registered") === true) {
          window.location.reload();
        }
      }
    });
  };

  if (done) {
    return (
      <Card>
        {/* DA-31: the page kept its scroll position on submit, so the
            confirmation landed above the fold and a player could not tell
            whether anything had happened. Focus moves here, which scrolls it
            into view and announces it to a screen reader in one act. */}
        <p
          data-testid="registration-submitted"
          ref={(node) => {
            node?.focus();
          }}
          tabIndex={-1}
          role="status"
        >
          You&apos;re in — status <Badge tone="info">submitted</Badge>. The organizer reviews every
          registration; your status updates on this page and on Home.
        </p>
      </Card>
    );
  }

  const steps: { key: Step; label: string }[] = [
    { key: "profile", label: "Your name" },
    { key: "role", label: "How you play" },
    { key: "review", label: "Review" },
  ];
  const stepIndex = steps.findIndex((entry) => entry.key === step);

  return (
    <Card data-testid="register-card">
      <p className="register-hint">
        Registering for <strong>{competitionName}</strong> as {formatPhone(phone)} — verified.
      </p>
      <ol className="register-progress" aria-label="Registration progress">
        {steps.map((entry, index) => (
          <li
            key={entry.key}
            className={`register-step ${index === stepIndex ? "register-step-current" : index < stepIndex ? "register-step-done" : ""}`}
            aria-current={index === stepIndex ? "step" : undefined}
          >
            <span className="register-step-number">{index + 1}</span>
            {entry.label}
          </li>
        ))}
      </ol>

      {step === "profile" ? (
        <form action={saveName} className="register-form" data-testid="register-step-profile">
          <Field
            label="Your name"
            name="name"
            required
            autoFocus
            autoComplete="name"
            defaultValue={name}
            placeholder="Rohan Kulkarni"
            help="Appears on the team sheet and the auction stage."
            {...(error !== null ? { error } : {})}
          />
          <Button type="submit" loading={pending}>
            Continue
          </Button>
        </form>
      ) : null}

      {step === "role" ? (
        <div className="register-form" data-testid="register-step-role">
          <Select
            label="Playing role"
            name="role"
            required
            value={role}
            onChange={(event) => {
              chooseRole(event.target.value);
            }}
            help="Saved as you go — you can come back any time."
            {...(error !== null ? { error } : {})}
          >
            <option value="">Choose your role…</option>
            {REGISTRATION_ROLES.map((entry) => (
              <option key={entry} value={entry}>
                {ROLE_LABEL[entry] ?? entry}
              </option>
            ))}
          </Select>
          <Field
            label="Date of birth (optional)"
            name="dateOfBirth"
            type="date"
            value={dob}
            onChange={(event) => {
              setDob(event.target.value);
              saveDraft({ dob: event.target.value });
            }}
            help="Shows your age on the player card. Only your age is shown, never the date."
          />
          <Select
            label="Batting style (optional)"
            name="battingStyle"
            value={batting}
            onChange={(event) => {
              setBatting(event.target.value);
              saveDraft({ batting: event.target.value });
            }}
          >
            <option value="">Not specified</option>
            {BATTING_STYLES.map((style) => (
              <option key={style} value={style}>
                {battingStyleLabel(style)}
              </option>
            ))}
          </Select>
          <Select
            label="Bowling style (optional)"
            name="bowlingStyle"
            value={bowling}
            onChange={(event) => {
              setBowling(event.target.value);
              saveDraft({ bowling: event.target.value });
            }}
          >
            <option value="">Not specified</option>
            {BOWLING_STYLES.map((style) => (
              <option key={style} value={style}>
                {bowlingStyleLabel(style)}
              </option>
            ))}
          </Select>
          <div className="register-actions">
            {!nameDone ? null : (
              <Button
                variant="ghost"
                onClick={() => {
                  setStep("profile");
                }}
              >
                Back
              </Button>
            )}
            <Button
              disabled={role === ""}
              data-testid="register-continue"
              onClick={() => {
                setError(null);
                setStep("review");
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="register-form" data-testid="register-step-review">
          {restored ? (
            <p className="register-hint" role="status" data-testid="draft-restored">
              We brought back the answers you had already given. Check them, or go Back to change
              anything.
            </p>
          ) : null}
          <dl className="register-review">
            <dt>Name</dt>
            <dd>{name}</dd>
            <dt>Mobile</dt>
            <dd>{formatPhone(phone)}</dd>
            <dt>Playing role</dt>
            <dd>{ROLE_LABEL[role] ?? role}</dd>
            {/* DA-21: step 2 collects date of birth and both styles, and the
                review showed none of them — you could not check what you were
                about to submit. Omitted rows stay omitted rather than printing
                "Not specified" three times for someone who skipped them. */}
            {dob !== "" ? (
              <>
                <dt>Date of birth</dt>
                <dd>{dob}</dd>
              </>
            ) : null}
            {isBattingStyle(batting) ? (
              <>
                <dt>Batting style</dt>
                <dd>{battingStyleLabel(batting)}</dd>
              </>
            ) : null}
            {isBowlingStyle(bowling) ? (
              <>
                <dt>Bowling style</dt>
                <dd>{bowlingStyleLabel(bowling)}</dd>
              </>
            ) : null}
          </dl>
          <div className="register-photo">
            <SelfPhotoUploader slug={slug} name={name} />
            {/* DA-35: the form asks a stranger for their face and their date of
                birth, and the only thing it said about either was that a photo
                "makes your player card stand out". Where the photo goes is not
                a detail — it goes on public pages. */}
            <p className="competitions-hint" data-testid="photo-privacy">
              A photo is optional. If you add one it becomes public: it appears on this
              season&apos;s public page, on the auction board and screen, and on link previews when
              the season is shared. You can remove it any time and it disappears from all of them.
            </p>
          </div>
          <p className="competitions-hint" data-testid="register-privacy">
            What the organizer of {competitionName} receives: your name, your mobile number, your
            playing role and anything optional you filled in above. It is used to run this season —
            to reach you about it and to put you in the auction. You can withdraw your registration
            from this page at any time.
          </p>
          {error !== null ? (
            <p role="alert" className="register-error">
              {error}
            </p>
          ) : null}
          <div className="register-actions">
            <Button
              variant="ghost"
              onClick={() => {
                setStep("role");
              }}
            >
              Back
            </Button>
            <Button loading={pending} data-testid="register-submit" onClick={submit}>
              Submit registration
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
