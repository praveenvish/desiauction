"use client";

import { Field } from "@desiauction/ui";
import { useState } from "react";

/**
 * A snake draft's pick order (SEO-1 Phase 4d): the order reverses every
 * round, so the team that picks last in one round picks first in the next.
 */
export function snakeOrder(teams: readonly string[], rounds: number): string[][] {
  return Array.from({ length: Math.max(0, rounds) }, (_, round) =>
    round % 2 === 0 ? [...teams] : [...teams].reverse(),
  );
}

const DEFAULT_TEAMS = ["Team 1", "Team 2", "Team 3", "Team 4", "Team 5", "Team 6"];

export function SnakeDraft() {
  const [names, setNames] = useState(DEFAULT_TEAMS.join("\n"));
  const [rounds, setRounds] = useState(4);
  const teams = names
    .split("\n")
    .map((name) => name.trim())
    .filter((name) => name !== "")
    .slice(0, 32);
  const order = snakeOrder(teams, Math.min(rounds, 30));

  return (
    <div className="tool-calc">
      <form
        className="tool-calc-form"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className="tool-textarea">
          <span>Teams, one per line, in first-round order</span>
          <textarea
            rows={8}
            value={names}
            onChange={(event) => {
              setNames(event.currentTarget.value);
            }}
          />
        </label>
        <Field
          label="Rounds"
          help="One round is one pick per team."
          inputMode="numeric"
          value={String(rounds)}
          onChange={(event) => {
            const parsed = Number.parseInt(event.currentTarget.value.replace(/[^\d]/g, ""), 10);
            setRounds(Number.isFinite(parsed) ? parsed : 0);
          }}
        />
      </form>
      <section className="tool-calc-results" aria-label="Pick order" aria-live="polite">
        {teams.length === 0 ? (
          <p>Add at least one team.</p>
        ) : (
          <ol className="tool-draft" data-testid="draft-order">
            {order.map((round, index) => (
              <li key={index}>
                <strong>Round {index + 1}</strong>
                <ol start={index * teams.length + 1}>
                  {round.map((team, pick) => (
                    <li key={`${team}-${String(pick)}`}>{team}</li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
