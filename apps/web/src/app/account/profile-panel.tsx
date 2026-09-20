"use client";

import { Button, Field, IconUser, SectionCard, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";

import { track } from "../../lib/telemetry";
import { updateProfileAction } from "../../server/auth/actions";
import { EmailVerify } from "./email-verify";
import { PhoneChange } from "./phone-change";

export interface ProfilePanelProps {
  phone: string | null;
  name: string | null;
  /** The address on file, if any, and whether it has been confirmed. */
  email: { email: string | null; verified: boolean };
}

/**
 * NAME & CONTACT — the display name, and each route the product reaches this
 * person by. Timezone and language are product rulings (IST, English) — not
 * settings, so not shown.
 *
 * The number and the address are rows with one button each: changing either is
 * a two-step, code-confirmed flow that opens under its row only when asked for.
 * The number is the one change that can take an account away from somebody, so
 * it never sits open beside the display name.
 */
export function ProfilePanel({ phone, name, email }: ProfilePanelProps) {
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

  return (
    <SectionCard
      id="profile"
      icon={<IconUser />}
      tone="gold"
      title="Name & contact"
      description="How you appear on team sheets, and how clubs reach you."
      className="acct-card"
      data-testid="profile-panel"
    >
      <form action={formAction} className="acct-name-form">
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
      <div className="acct-contacts">
        <PhoneChange current={phone} />
        {/* Beside the identity it belongs to: this is a contact route the
            product will actually use (receipts, documents), not a credential. */}
        <EmailVerify current={email.email} verified={email.verified} />
      </div>
    </SectionCard>
  );
}
