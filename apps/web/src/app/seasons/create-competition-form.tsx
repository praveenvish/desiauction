"use client";

import { Button, Field, Select } from "@desiauction/ui";
import { useActionState } from "react";

import { createCompetitionAction } from "../../server/competition/actions";

export function CreateCompetitionForm({
  orgs,
  tournamentId,
}: {
  orgs: { id: string; name: string }[];
  /**
   * Set when the form is rendered inside a tournament: the new season becomes
   * an edition of it. Left undefined on /seasons, where a season is a one-off —
   * `competitions.tournament_id` is nullable precisely so that stays possible.
   */
  tournamentId?: string;
}) {
  const [state, formAction, pending] = useActionState(createCompetitionAction, {});
  return (
    <form action={formAction} className="create-competition" data-testid="create-competition">
      {tournamentId !== undefined ? (
        <input type="hidden" name="tournamentId" value={tournamentId} />
      ) : null}
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
        label="Season name"
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
        Create season
      </Button>
    </form>
  );
}
