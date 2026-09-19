"use client";

import { PROFILE_ITEMS, type ProfileCompleteness, type ProfileItem } from "@desiauction/core";
import {
  Badge,
  Button,
  Card,
  Field,
  PlayerImage,
  useToast,
  IconCheckCircle,
  IconCircle,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";

import { personContact } from "../../lib/person-label";
import { track } from "../../lib/telemetry";
import { updateProfileAction } from "../../server/auth/actions";
import { PhoneChange } from "./phone-change";

export interface ProfilePanelProps {
  personId: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  /** Their own photo, consent-gated and signed server-side; null → initials mark. */
  photoUrl: string | null;
  /** PI-1: computed server-side by core's profileCompleteness — never stored. */
  completeness: ProfileCompleteness;
  /** The sign-out form, which must be a client component to sweep localStorage. */
  signOut: ReactNode;
}

/**
 * The checklist's words (codes come from core, copy lives with the surface —
 * the publishBlockers pattern). Order mirrors PROFILE_ITEMS.
 */
const ITEM_LABELS: Record<ProfileItem, { label: string; hint?: string }> = {
  name: { label: "Name set" },
  photo: { label: "Profile photo", hint: "added when you register for a season" },
  role: { label: "Playing role", hint: "under Sports" },
  date_of_birth: { label: "Date of birth", hint: "under Player profile" },
  style: { label: "Batting or bowling style", hint: "under Sports" },
  location: { label: "City", hint: "under Player profile" },
  email: { label: "Verified email", hint: "for receipts and documents" },
  passkey: { label: "Passkey", hint: "the fastest way to sign in" },
};

/**
 * PX-3 profile: the existing identity, made visible and editable.
 * Avatar is the person's own photo once they have uploaded one (upload
 * arrives with player registration consent — photoConsent columns — not
 * here), and the branded generated identity (C-25) until then. Timezone and
 * language are product rulings (IST, English) — not settings, so not shown.
 *
 * This is now the ONE identity card on the page: the headless <dl> that used to
 * sit above it repeated the same phone and name with no heading of its own.
 */
export function ProfilePanel({
  personId,
  phone,
  email,
  name,
  photoUrl,
  completeness,
  signOut,
}: ProfilePanelProps) {
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
  const missing = new Set(completeness.missing);

  return (
    <Card className="profile-card" data-testid="profile-panel">
      <div className="profile-head">
        <PlayerImage
          name={hasName ? name : "New member"}
          seed={personId}
          src={photoUrl}
          size="lg"
          shape="round"
          decorative
        />
        <div className="profile-id">
          <h2 className="profile-name" data-testid="account-name">
            {hasName ? name : "Your profile"}
          </h2>
          <p className="profile-phone">
            {/*
              The one screen whose entire job is "is this YOUR number?" printed
              the raw stored identifier, +919999000001, while the shell menu one
              click away — and nine other surfaces — grouped it. `formatPhone`'s
              own doc comment names this screen.
            */}
            {/* Since 0062 an account may be anchored by an email instead, in
                which case there is no number to be asked about — the address
                that signs them in takes the line. */}
            <span data-testid="account-phone">{personContact({ phone, email })}</span>{" "}
            <Badge tone="success">Verified</Badge>
          </p>
        </div>
        <div className="profile-signout">{signOut}</div>
      </div>
      {/* PI-1: the real checklist — everything the product actually uses,
          derived per read by core's profileCompleteness. Up top, as a meter:
          it is the one thing on this page that says what to do next. */}
      <div className="profile-completion" data-testid="profile-completion">
        <div className="profile-completion-head">
          <span className="profile-completion-label">
            Profile {completeness.done}/{completeness.total} complete
          </span>
          <span className="profile-meter" aria-hidden>
            <i
              style={{
                width: `${String(Math.round((completeness.done / Math.max(1, completeness.total)) * 100))}%`,
              }}
            />
          </span>
        </div>
        <ul>
          {PROFILE_ITEMS.map((item) => {
            const itemDone = !missing.has(item);
            const { label, hint } = ITEM_LABELS[item];
            return (
              <li key={item} data-done={itemDone}>
                {itemDone ? (
                  <IconCheckCircle size={16} className="icon-lead" />
                ) : (
                  <IconCircle size={16} className="icon-lead" />
                )}
                <span>
                  {label}
                  {!itemDone && hint !== undefined ? (
                    <span className="profile-hint"> · {hint}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
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
        <div className="profile-save">
          <Button type="submit" loading={pending} variant="secondary">
            Save name
          </Button>
        </div>
      </form>
      {/* Behind a disclosure, under the name. This is the one change that can
          take an account away from somebody — it does not belong in the same
          open form as the display name. */}
      <PhoneChange current={phone} />
    </Card>
  );
}
