"use client";

import { Button, Card, Field } from "@desiauction/ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewTeamEntryAction } from "../../../../server/competition/team-entry-actions";

interface Entry {
  id: string;
  teamName: string;
  players: { name: string; phone?: string }[];
  status: string;
}

export function TeamEntriesPanel({
  slug,
  code,
  entries,
}: {
  slug: string;
  code: string | null;
  entries: Entry[];
}) {
  const router = useRouter();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const review = async (id: string, decision: "approve" | "reject") => {
    setPending(id);
    const result = await reviewTeamEntryAction(slug, id, decision, reasons[id] ?? "");
    setPending(null);
    if (result.ok) router.refresh();
    else setError(result.error ?? "The team could not be reviewed.");
  };
  return (
    <section aria-label="Team sign-ups">
      <h2>Team sign-ups</h2>
      {code !== null ? (
        <p>
          Invite captains with <a href={`/join/${code}`}>/join/{code}</a>. They can submit a team;
          this link gives no club access.
        </p>
      ) : null}
      {error !== "" ? <p role="alert">{error}</p> : null}
      {entries.length === 0 ? (
        <p>No teams submitted yet.</p>
      ) : (
        entries.map((entry) => (
          <Card key={entry.id}>
            <h3>{entry.teamName}</h3>
            <p>
              {entry.status} · {entry.players.length} players
            </p>
            <ul>
              {entry.players.map((player, index) => (
                <li key={index}>{player.name}</li>
              ))}
            </ul>
            {entry.status === "submitted" ? (
              <>
                <Field
                  label={`Rejection reason for ${entry.teamName}`}
                  value={reasons[entry.id] ?? ""}
                  onChange={(event) => {
                    setReasons({ ...reasons, [entry.id]: event.target.value });
                  }}
                />
                <Button
                  loading={pending === entry.id}
                  onClick={() => {
                    void review(entry.id, "approve");
                  }}
                >
                  Approve {entry.teamName}
                </Button>
                <Button
                  variant="secondary"
                  disabled={pending !== null}
                  onClick={() => {
                    void review(entry.id, "reject");
                  }}
                >
                  Reject {entry.teamName}
                </Button>
              </>
            ) : null}
          </Card>
        ))
      )}
    </section>
  );
}
