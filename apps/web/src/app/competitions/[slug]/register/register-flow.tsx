"use client";

import { REGISTRATION_ROLES } from "@desiauction/core";
import { Badge, Button, Card, Field, Select } from "@desiauction/ui";
import { useEffect, useState, useTransition } from "react";

import { track } from "../../../../lib/telemetry";
import { updateProfileAction } from "../../../../server/auth/actions";
import { submitRegistrationAction } from "../../../../server/competition/actions";

const ROLE_LABEL: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  all_rounder: "All-rounder",
  wicket_keeper: "Wicket-keeper",
};

type Step = "profile" | "role" | "review";

const draftKey = (slug: string) => `da:reg-draft:${slug}`;

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
}: {
  slug: string;
  competitionName: string;
  phone: string;
  initialName: string;
}) {
  const [name, setName] = useState(initialName);
  const [nameDone, setNameDone] = useState(initialName.trim() !== "");
  const [role, setRole] = useState("");
  const [step, setStep] = useState<Step>(nameDone ? "role" : "profile");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  // Draft recovery: restore the saved role and resume at review after a
  // refresh or a browser restart.
  useEffect(() => {
    const saved = window.localStorage.getItem(draftKey(slug));
    if (saved !== null && saved !== "") {
      setRole(saved);
      if (initialName.trim() !== "") {
        setStep("review");
      }
    }
  }, [slug, initialName]);

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
    window.localStorage.setItem(draftKey(slug), value);
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("role", role);
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
        <p data-testid="registration-submitted">
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
        Registering for <strong>{competitionName}</strong> as {phone} — verified.
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
          <dl className="register-review">
            <dt>Name</dt>
            <dd>{name}</dd>
            <dt>Mobile</dt>
            <dd>{phone}</dd>
            <dt>Playing role</dt>
            <dd>{ROLE_LABEL[role] ?? role}</dd>
          </dl>
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
