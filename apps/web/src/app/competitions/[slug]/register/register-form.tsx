"use client";

import { REGISTRATION_ROLES } from "@desiauction/core";
import { Badge, Button, Select } from "@desiauction/ui";
import { useActionState } from "react";

import { submitRegistrationAction } from "../../../../server/competition/actions";

export function RegisterForm({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState(
    (previous: { error?: string; done?: boolean }, formData: FormData) =>
      submitRegistrationAction(slug, previous, formData),
    {},
  );
  if (state.done === true) {
    return (
      <p data-testid="registration-submitted">
        You&apos;re in — status <Badge tone="info">submitted</Badge>. The organizer will review your
        application.
      </p>
    );
  }
  return (
    <form action={formAction} className="register-form" data-testid="register-form">
      <Select
        label="Playing role"
        name="role"
        required
        {...(state.error !== undefined ? { error: state.error } : {})}
      >
        {REGISTRATION_ROLES.map((role) => (
          <option key={role} value={role}>
            {role.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      <Button type="submit" loading={pending}>
        Submit registration
      </Button>
    </form>
  );
}
