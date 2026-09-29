"use client";

import { Button } from "@desiauction/ui";
import { useId, useState } from "react";

import type { OrganizerFixture } from "../../server/competition/fixtures";
import { DuelResultForm } from "../seasons/[slug]/fixtures/result-form";

/**
 * THE SCORE, WITHOUT LEAVING HOME (census 15). "Enter score" on the Today
 * list used to open the season's schedule, find the match and open its panel
 * — three screens to type two numbers. It opens the same form here, under the
 * match; saving finishes the match and the refreshed list drops the row.
 *
 * A lobby (placings for every squad) still opens its panel: that form wants
 * the whole field of squads, which the Today list does not carry.
 */
export function TodayScore({
  slug,
  fixture,
  scoreFields,
  overdue,
}: {
  slug: string;
  fixture: OrganizerFixture;
  scoreFields: readonly { key: string; label: string; help?: string }[];
  /** The match's day has passed — the Today list's "Result due". */
  overdue: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <>
      <Button
        size="sm"
        variant={open ? "secondary" : "primary"}
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => {
          setOpen(!open);
        }}
        data-testid={`today-score-${fixture.id}`}
      >
        {open ? "Close" : "Enter score"}
      </Button>
      {open ? (
        <div className="ot-score" id={panel} data-testid={`today-score-form-${fixture.id}`}>
          <DuelResultForm
            slug={slug}
            fixture={fixture}
            result={undefined}
            scoreFields={scoreFields}
            overdue={overdue}
          />
        </div>
      ) : null}
    </>
  );
}
