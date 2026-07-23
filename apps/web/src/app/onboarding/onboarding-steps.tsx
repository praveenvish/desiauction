"use client";

import { Button, ButtonLink, Field } from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { track } from "../../lib/telemetry";
import { updateProfileAction } from "../../server/auth/actions";
import { createOrgAction } from "../../server/orgs/actions";

export interface OnboardingPanelProps {
  step: "name" | "org" | "done";
  phone: string;
  name: string;
}

const STEPS = [
  { key: "name", label: "Your name" },
  { key: "org", label: "Your organization" },
] as const;

export function OnboardingPanel({ step, phone, name }: OnboardingPanelProps) {
  useEffect(() => {
    track("onboarding.step_viewed", { step });
  }, [step]);

  return (
    <>
      <h1>
        {step === "name"
          ? "Welcome to DesiAuction"
          : step === "org"
            ? `Welcome, ${name}`
            : "You're all set"}
      </h1>
      {step !== "done" ? (
        <>
          <p className="onboarding-sub">
            {step === "name"
              ? "Two quick steps and you're in."
              : "One more step — where will you run tournaments?"}
          </p>
          <ol className="onboarding-progress" aria-label="Onboarding progress">
            {STEPS.map((entry, index) => {
              const stateOf =
                entry.key === step
                  ? "current"
                  : STEPS.findIndex((s) => s.key === step) > index
                    ? "done"
                    : "todo";
              return (
                <li
                  key={entry.key}
                  className={`onboarding-step onboarding-step-${stateOf}`}
                  aria-current={stateOf === "current" ? "step" : undefined}
                >
                  <span className="onboarding-step-number">{index + 1}</span>
                  {entry.label}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
      {step === "name" ? <NameStep phone={phone} /> : null}
      {step === "org" ? <OrgStep /> : null}
      {step === "done" ? <DoneStep /> : null}
    </>
  );
}

function NameStep({ phone }: { phone: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateProfileAction, {});

  useEffect(() => {
    if (state.saved === true) {
      track("profile.completed");
      // Server state now carries the name; re-derive the step.
      router.refresh();
    }
  }, [state.saved, router]);

  return (
    <form action={formAction} className="onboarding-form" data-testid="onboarding-name">
      <p className="onboarding-hint">
        Signed in as <strong>{phone}</strong> — verified.
      </p>
      <Field
        label="What should we call you?"
        name="name"
        required
        autoFocus
        autoComplete="name"
        placeholder="Rohan Kulkarni"
        help="Appears on team sheets and the auction stage."
        {...(state.error !== undefined ? { error: state.error } : {})}
      />
      <Button type="submit" loading={pending || state.saved === true}>
        Continue
      </Button>
    </form>
  );
}

function OrgStep() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createOrgAction, {});
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const followInvite = () => {
    const match = /\/join\/([A-Za-z0-9_-]+)/.exec(inviteUrl.trim());
    const token =
      match?.[1] ?? (/^[A-Za-z0-9_-]{10,}$/.test(inviteUrl.trim()) ? inviteUrl.trim() : null);
    if (token === null) {
      setInviteError("That doesn't look like an invite link — it contains /join/…");
      return;
    }
    router.push(`/join/${token}`);
  };

  return (
    <div className="onboarding-org" data-testid="onboarding-org">
      <form
        action={formAction}
        className="onboarding-form"
        onSubmit={() => {
          track("org.created", { via: "onboarding" });
        }}
      >
        <h2>Run your own tournaments</h2>
        <Field
          label="Organization name"
          name="name"
          placeholder="Malad Premier League"
          required
          help="Your club, league or association. You can invite co-organizers later."
          {...(state.error !== undefined ? { error: state.error } : {})}
        />
        <Button type="submit" loading={pending}>
          Create organization
        </Button>
      </form>
      <div className="onboarding-divider" role="presentation">
        or
      </div>
      <div className="onboarding-form">
        <h2>Join with an invite</h2>
        <Field
          label="Paste your invite link"
          name="invite"
          placeholder="https://…/join/…"
          value={inviteUrl}
          onChange={(event) => {
            setInviteUrl(event.target.value);
            setInviteError(null);
          }}
          {...(inviteError !== null ? { error: inviteError } : {})}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={followInvite}
          data-testid="follow-invite"
        >
          Continue with invite
        </Button>
      </div>
      <p className="onboarding-skip">
        Just here to register as a player or watch an auction?{" "}
        <Link
          href="/home"
          data-testid="onboarding-skip"
          onClick={() => {
            track("onboarding.completed", { via: "skip" });
          }}
        >
          Skip for now
        </Link>
      </p>
    </div>
  );
}

function DoneStep() {
  useEffect(() => {
    track("onboarding.completed", { via: "done" });
  }, []);
  return (
    <div className="onboarding-form" data-testid="onboarding-done">
      <p className="onboarding-sub">
        Your profile and organization are ready. The next stop is your home — seasons,
        registrations and auction night all start there.
      </p>
      <ButtonLink href="/home">Go to Home</ButtonLink>
    </div>
  );
}
