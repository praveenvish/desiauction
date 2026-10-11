"use client";

import { Button, Field } from "@desiauction/ui";
import { useState } from "react";
import { submitTeamEntryAction } from "../../../server/competition/team-entry-actions";

export function TeamEntryForm({ code }: { code: string }) {
  const [players, setPlayers] = useState([{ name: "", phone: "" }]);
  const [teamName, setTeamName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  if (submitted)
    return (
      <p role="status">
        Your team has been submitted. The organizer will review it before it joins the season.
      </p>
    );
  const submit = async () => {
    setPending(true);
    const result = await submitTeamEntryAction(code, { teamName, players });
    setPending(false);
    if (result.ok) setSubmitted(true);
    else setError(result.error ?? "Your team could not be submitted.");
  };
  return (
    <form
      className="team-entry-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field
        label="Team name"
        value={teamName}
        onChange={(event) => {
          setTeamName(event.target.value);
        }}
        required
        minLength={3}
        maxLength={120}
      />
      {players.map((player, index) => (
        <fieldset key={index}>
          <legend>Player {index + 1}</legend>
          <Field
            label={`Player ${String(index + 1)} name`}
            required
            maxLength={120}
            value={player.name}
            onChange={(event) => {
              setPlayers(
                players.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)),
              );
            }}
          />
          <Field
            label={`Player ${String(index + 1)} mobile (optional)`}
            type="tel"
            value={player.phone}
            onChange={(event) => {
              setPlayers(
                players.map((row, i) =>
                  i === index ? { ...row, phone: event.target.value } : row,
                ),
              );
            }}
          />
        </fieldset>
      ))}
      {players.length < 30 ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setPlayers([...players, { name: "", phone: "" }]);
          }}
        >
          Add player
        </Button>
      ) : null}
      <p>
        Up to 30 players. Players without a mobile stay club-only until they link their account.
      </p>
      {error !== "" ? <p role="alert">{error}</p> : null}
      <Button type="submit" loading={pending}>
        Submit team
      </Button>
    </form>
  );
}
