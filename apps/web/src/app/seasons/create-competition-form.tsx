"use client";

import { Button, Field, Select } from "@desiauction/ui";
import { useActionState } from "react";

import {
  createCompetitionAction,
  type CompetitionFormField,
} from "../../server/competition/actions";

export function CreateCompetitionForm({
  orgs,
  sports,
  tournamentId,
}: {
  orgs: { id: string; name: string }[];
  /**
   * The sports currently switched on (SP-1 Phase 1, migration 0046).
   *
   * A picker over ONE option is friction carrying no information, so the field
   * only appears once there is a genuine choice; with a single enabled sport
   * the form posts it as a hidden input instead. That is deliberately not the
   * same as posting nothing — the column's default would also produce
   * "cricket", but a row that says cricket because somebody's form said so and
   * a row that says cricket because nobody asked are different facts, and
   * Phase 2 drops that default. The day a second pack is enabled, the picker
   * appears on all eight call sites at once with no edit here.
   */
  sports: { key: string; label: string }[];
  /**
   * Set when the form is rendered inside a tournament: the new season becomes
   * an edition of it. Left undefined on /seasons, where a season is a one-off —
   * `competitions.tournament_id` is nullable precisely so that stays possible.
   */
  tournamentId?: string;
}) {
  const [state, formAction, pending] = useActionState(createCompetitionAction, {});
  /**
   * The message goes under the control that caused it, and nowhere else.
   * Every rejection used to be bound to "Season name" — including the reversed
   * date range, which was printed two fields above the inputs it was about.
   */
  const errorFor = (field: CompetitionFormField): { error: string } | Record<string, never> =>
    state.error !== undefined && state.field === field ? { error: state.error } : {};
  // Rejections that belong to no single control (an authorisation refusal, a
  // forged tournament id) had nowhere to land at all, so they were shown under
  // the name field or not at all. They get their own announced region.
  const formError = state.error !== undefined && state.field === "form" ? state.error : null;

  return (
    <form action={formAction} className="create-competition" data-testid="create-competition">
      {tournamentId !== undefined ? (
        <input type="hidden" name="tournamentId" value={tournamentId} />
      ) : null}
      {formError !== null ? (
        <p
          className="create-competition-error"
          role="alert"
          aria-live="assertive"
          data-testid="create-competition-error"
        >
          {formError}
        </p>
      ) : null}
      {orgs.length === 1 ? (
        <input type="hidden" name="orgId" value={orgs[0]?.id ?? ""} />
      ) : (
        <Select label="Organization" name="orgId" required {...errorFor("orgId")}>
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
        {...errorFor("name")}
      />
      {sports.length > 1 ? (
        <Select label="Sport" name="sport" required defaultValue={sports[0]?.key ?? ""}>
          {sports.map((sport) => (
            <option key={sport.key} value={sport.key}>
              {sport.label}
            </option>
          ))}
        </Select>
      ) : sports.length === 1 ? (
        <input type="hidden" name="sport" value={sports[0]?.key ?? ""} />
      ) : null}

      <Field label="Location" name="location" placeholder="Malad, Mumbai" />
      <div className="date-row">
        <Field label="Starts on" name="startsOn" type="date" />
        <Field label="Ends on" name="endsOn" type="date" {...errorFor("endsOn")} />
      </div>
      <Button type="submit" loading={pending}>
        Create season
      </Button>
    </form>
  );
}
