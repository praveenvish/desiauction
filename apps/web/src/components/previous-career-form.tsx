"use client";
import { Button, Field } from "@desiauction/ui";
import { useActionState } from "react";
import { updatePreviousCareerAction } from "../server/player/previous-career-actions";
import type { PreviousCareerSummary } from "../server/player/previous-career";
export function PreviousCareerForm({ summary }: { summary: PreviousCareerSummary | null }) {
  const [state, action, pending] = useActionState(updatePreviousCareerAction, {});
  return (
    <section className="cricket-career" aria-labelledby="previous-career-heading">
      <h2 id="previous-career-heading">Before DesiAuction · Self-reported</h2>
      <p>Your own history. Not checked, not counted in scored figures or on leaderboards.</p>
      {summary ? (
        <p>
          {summary.runs === undefined ? "" : `${String(summary.runs)} runs · `}
          {summary.wickets === undefined ? "" : `${String(summary.wickets)} wickets · `}
          {summary.fromYear === undefined ? "" : String(summary.fromYear)}
          {summary.toYear === undefined ? "" : `–${String(summary.toYear)}`}
          {summary.source ? ` · ${summary.source}` : ""}
        </p>
      ) : null}
      <details>
        <summary>{summary ? "Edit your history" : "Add your previous history"}</summary>
        <form action={action}>
          {(
            [
              ["matches", "Matches"],
              ["runs", "Runs"],
              ["wickets", "Wickets"],
              ["fromYear", "From year"],
              ["toYear", "To year"],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              name={`previousCareer_${key}`}
              type="number"
              min={key.includes("Year") ? 1900 : 0}
              step="1"
              defaultValue={summary?.[key]}
            />
          ))}
          <Field label="Source" name="source" maxLength={120} defaultValue={summary?.source} />
          <Button loading={pending} size="touch" type="submit" name="intent" value="save">
            Save history
          </Button>
          {summary ? (
            <Button
              loading={pending}
              size="touch"
              variant="ghost"
              type="submit"
              name="intent"
              value="delete"
            >
              Remove history
            </Button>
          ) : null}
          <p role="status">{state.error ?? (state.saved ? "History saved." : "")}</p>
        </form>
      </details>
    </section>
  );
}
