"use client";

import { Card, Select } from "@desiauction/ui";
import { useState } from "react";

import { SportProfilePanel, type SportFormSpec } from "./sport-profile-panel";

export interface SportProfileForm {
  spec: SportFormSpec;
  defaultRole: string | null;
  attributes: Record<string, string>;
  /** Has a profile for this sport, or has entered a season of it. */
  played: boolean;
}

/**
 * THE SPORTS YOU PLAY, AND A WAY TO ADD ONE.
 *
 * /account rendered a profile form for every sport the PLATFORM runs. At four
 * that was defensible; at eight it is a wall of forms for a cricketer, seven of
 * which ask how they bowl in a game they have never entered — and it gets worse
 * with every pack, which is the wrong direction for a screen to move as the
 * product succeeds.
 *
 * So the page shows what a person plays, and offers the rest one at a time.
 *
 * THE ADD CONTROL IS NOT OPTIONAL POLISH. Without it a filter is a trap: a
 * player who has never registered anywhere would see NO panels at all and have
 * no way to fill one in before their first season — the exact case /account
 * exists to serve, since these answers prefill every future registration. It is
 * also how somebody records a sport they play before the organizer opens
 * intake.
 *
 * REVEALED, NOT SAVED. Choosing a sport here only shows its form; nothing is
 * written until the organizer— the PLAYER — submits it. So an accidental pick
 * costs a glance, not a row, and the page does not quietly claim they play
 * something they clicked past.
 */
export function SportProfiles({ forms }: { forms: readonly SportProfileForm[] }) {
  const [added, setAdded] = useState<readonly string[]>([]);
  const shows = (form: SportProfileForm): boolean => form.played || added.includes(form.spec.key);
  const shown = forms.filter(shows);
  const rest = forms.filter((form) => !shows(form));

  return (
    <>
      {shown.map((form) => (
        <SportProfilePanel
          key={form.spec.key}
          spec={form.spec}
          defaultRole={form.defaultRole}
          attributes={form.attributes}
        />
      ))}
      {rest.length > 0 ? (
        <Card data-testid="add-sport">
          <h2>Play something else?</h2>
          <p className="dash-hint">
            {shown.length === 0
              ? "Tell us how you play and we'll prefill it into every season you enter."
              : "Add a sport and we'll prefill it the next time you register for one."}
          </p>
          <Select
            label="Add a sport"
            name="add-sport"
            value=""
            onChange={(event) => {
              const key = event.target.value;
              if (key !== "") {
                setAdded((prev) => [...prev, key]);
              }
            }}
          >
            {/* Value stays "" so the control returns to its prompt after each
                pick — it is an action, not a stored choice, and leaving the
                last sport selected would read as though it were. */}
            <option value="">Choose a sport…</option>
            {rest.map((form) => (
              <option key={form.spec.key} value={form.spec.key}>
                {form.spec.label}
              </option>
            ))}
          </Select>
        </Card>
      ) : null}
    </>
  );
}
