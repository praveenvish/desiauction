"use client";

import { Button, Field } from "@desiauction/ui";
import { useActionState } from "react";

import { createOrgAction } from "../../server/orgs/actions";

export function CreateOrgForm() {
  const [state, formAction, pending] = useActionState(createOrgAction, {});
  return (
    <form action={formAction} className="create-org">
      <Field
        label="Organization name"
        name="name"
        placeholder="Malad Premier League"
        required
        {...(state.error !== undefined ? { error: state.error } : {})}
      />
      <Button type="submit" loading={pending}>
        Create organization
      </Button>
    </form>
  );
}
