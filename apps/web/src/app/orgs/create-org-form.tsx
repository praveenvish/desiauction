"use client";

import { Button, Field } from "@desiauction/ui";
import { useActionState } from "react";

import { createOrgAction } from "../../server/orgs/actions";

export function CreateOrgForm() {
  const [state, formAction, pending] = useActionState(createOrgAction, {});
  return (
    <form action={formAction} className="create-org">
      {/* The sibling "New tournament" dialog explains what a tournament is;
          this one asked for a name and said nothing, and the placeholder
          ("Malad Premier League") named a LEAGUE — the exact thing an
          organization is not. */}
      <Field
        label="Organization name"
        name="name"
        placeholder="Malad Cricket Club"
        help="Your club's real name — 'Malad Cricket Club', not this year's league. You'll be its owner, and you can invite people once it exists."
        required
        {...(state.error !== undefined ? { error: state.error } : {})}
      />
      <Button type="submit" loading={pending}>
        Create organization
      </Button>
    </form>
  );
}
