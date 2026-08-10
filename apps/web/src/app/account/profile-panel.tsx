"use client";

import { Badge, Button, Card, Field, PlayerImage, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";

import { formatPhone } from "../../lib/format-phone";
import { track } from "../../lib/telemetry";
import { updateProfileAction } from "../../server/auth/actions";
import { PhoneChange } from "./phone-change";

export interface ProfilePanelProps {
  personId: string;
  phone: string;
  name: string | null;
  passkeyCount: number;
  /** The sign-out form, which must be a client component to sweep localStorage. */
  signOut: ReactNode;
}

/**
 * PX-3 profile: the existing identity, made visible and editable.
 * Avatar is the branded generated identity (C-25) — photo upload arrives with
 * player registration consent (photoConsent columns), not here. Timezone and
 * language are product rulings (IST, English) — not settings, so not shown.
 *
 * This is now the ONE identity card on the page: the headless <dl> that used to
 * sit above it repeated the same phone and name with no heading of its own.
 */
export function ProfilePanel({ personId, phone, name, passkeyCount, signOut }: ProfilePanelProps) {
  const router = useRouter();
  const toast = useToast();
  const [state, formAction, pending] = useActionState(updateProfileAction, {});
  const announced = useRef(false);

  useEffect(() => {
    if (state.saved === true && !announced.current) {
      announced.current = true;
      track("profile.updated");
      // "Name updated" was said to people who had just SET a name for the first
      // time. The action now reports which of the two happened.
      toast({ tone: "success", title: state.firstTime === true ? "Name added" : "Name updated" });
      router.refresh();
    }
    if (state.saved !== true) {
      announced.current = false;
    }
  }, [state.saved, state.firstTime, router, toast]);

  const hasName = name !== null && name.trim() !== "";
  const done = (hasName ? 1 : 0) + (passkeyCount > 0 ? 1 : 0);

  return (
    <Card className="profile-card" data-testid="profile-panel">
      <div className="profile-head">
        <PlayerImage name={hasName ? name : "New member"} seed={personId} size="md" shape="round" />
        <div className="profile-id">
          <h2>Profile</h2>
          <p className="profile-name" data-testid="account-name">
            {hasName ? name : "—"}
          </p>
          <p className="profile-phone">
            {/*
              The one screen whose entire job is "is this YOUR number?" printed
              the raw stored identifier, +919999000001, while the shell menu one
              click away — and nine other surfaces — grouped it. `formatPhone`'s
              own doc comment names this screen.
            */}
            <span data-testid="account-phone">{formatPhone(phone)}</span>{" "}
            <Badge tone="success">Verified</Badge>
          </p>
        </div>
        <div className="profile-signout">{signOut}</div>
      </div>
      {/* Beside the number it changes, and behind a disclosure. This is the one
          change that can take an account away from somebody — it does not
          belong in the same open form as the display name. */}
      <PhoneChange current={phone} />
      <form action={formAction} className="profile-form">
        <Field
          label="Display name"
          name="name"
          defaultValue={name ?? ""}
          required
          autoComplete="name"
          help="Appears on team sheets and the auction stage. Your avatar is generated from it."
          {...(state.error !== undefined ? { error: state.error } : {})}
        />
        <div className="profile-save">
          <Button type="submit" loading={pending} variant="secondary">
            Save name
          </Button>
        </div>
      </form>
      <div className="profile-completion" data-testid="profile-completion">
        <span className="profile-completion-label">Profile {done}/2 complete</span>
        <ul>
          <li data-done={hasName}>{hasName ? "✓" : "○"} Name set</li>
          <li data-done={passkeyCount > 0}>
            {passkeyCount > 0 ? "✓" : "○"} Passkey added{" "}
            {passkeyCount === 0 ? (
              <span className="profile-hint">— fastest sign-in, below</span>
            ) : null}
          </li>
        </ul>
      </div>
    </Card>
  );
}
