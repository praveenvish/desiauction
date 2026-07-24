"use client";

import { Button, Field, Select } from "@desiauction/ui";
import { useActionState } from "react";

import { createTournamentAction } from "../../server/competition/tournament-actions";

/**
 * A tournament is a name and an owning org — nothing else. It carries no
 * status, dates, teams or money; those belong to its seasons. Asking for more
 * here would be asking for facts that have no home.
 */
export function CreateTournamentForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createTournamentAction, {});
  return (
    <form action={action} className="competitions-form" id="create-tournament">
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
        label="Tournament name"
        name="name"
        required
        placeholder="Bandra Premier League"
        help="The recurring competition. Its seasons are the editions that run."
        {...(state.error !== undefined ? { error: state.error } : {})}
      />
      <Button type="submit" loading={pending}>
        Create tournament
      </Button>
    </form>
  );
}
