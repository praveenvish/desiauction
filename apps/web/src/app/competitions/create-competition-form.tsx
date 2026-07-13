"use client";

import { Button, Field, Select } from "@desiauction/ui";
import { useActionState } from "react";

import { createCompetitionAction } from "../../server/competition/actions";

export function CreateCompetitionForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createCompetitionAction, {});
  return (
    <form action={formAction} className="create-competition" data-testid="create-competition">
      {orgs.length === 1 ? (
        <input type="hidden" name="orgId" value={orgs[0]?.id ?? ""} />
      ) : (
        <Select label="Organization" name="orgId" required>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </Select>
      )}
      <Field
        label="Competition name"
        name="name"
        placeholder="Malad Premier League 2026"
        required
        {...(state.error !== undefined ? { error: state.error } : {})}
      />
      <Field label="Location" name="location" placeholder="Malad, Mumbai" />
      <div className="date-row">
        <Field label="Starts on" name="startsOn" type="date" />
        <Field label="Ends on" name="endsOn" type="date" />
      </div>
      <Button type="submit" loading={pending}>
        Create competition
      </Button>
    </form>
  );
}
