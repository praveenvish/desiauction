"use client";

import { Badge, Button, Card, Field, PlayerImage, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";

import { track } from "../../lib/telemetry";
import { updateProfileAction } from "../../server/auth/actions";

export interface ProfilePanelProps {
  personId: string;
  phone: string;
  name: string | null;
  passkeyCount: number;
}

/**
 * PX-3 profile: the existing identity, made visible and editable.
 * Avatar is the branded generated identity (C-25) — photo upload arrives with
 * player registration consent (photoConsent columns), not here. Timezone and
 * language are product rulings (IST, English) — not settings, so not shown.
 */
export function ProfilePanel({ personId, phone, name, passkeyCount }: ProfilePanelProps) {
  const router = useRouter();
  const toast = useToast();
  const [state, formAction, pending] = useActionState(updateProfileAction, {});
  const announced = useRef(false);

  useEffect(() => {
    if (state.saved === true && !announced.current) {
      announced.current = true;
      track("profile.updated");
      toast({ tone: "success", title: "Name updated" });
      router.refresh();
    }
    if (state.saved !== true) {
      announced.current = false;
    }
  }, [state.saved, router, toast]);

  const hasName = name !== null && name.trim() !== "";
  const done = (hasName ? 1 : 0) + (passkeyCount > 0 ? 1 : 0);

  return (
    <Card className="profile-card" data-testid="profile-panel">
      <div className="profile-head">
        <PlayerImage
          name={name !== null && name.trim() !== "" ? name : "New member"}
          seed={personId}
          size="md"
          shape="round"
        />
        <div className="profile-id">
          <h2>Profile</h2>
          <p className="profile-phone">
            {phone} <Badge tone="success">Verified</Badge>
          </p>
        </div>
      </div>
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
        <Button type="submit" loading={pending} variant="secondary">
          Save name
        </Button>
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
