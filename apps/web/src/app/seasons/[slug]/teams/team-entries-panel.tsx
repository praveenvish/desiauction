"use client";

import { Button, Card, Field, Pill, SectionCard, IconUsers } from "@desiauction/ui";
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
    if (pending !== null) return;
    setPending(id);
    setError("");
    try {
      const result = await reviewTeamEntryAction(slug, id, decision, reasons[id] ?? "");
      if (result.ok) router.refresh();
      else setError(result.error ?? "The team could not be reviewed.");
    } catch {
      setError(
        "We couldn't receive the review result. Refresh to check the team's status before trying again.",
      );
    } finally {
      setPending(null);
    }
  };
  return (
    <SectionCard
      title="Team sign-ups"
      description="Review submitted squads before adding them to this season."
      icon={<IconUsers />}
      data-testid="team-entries"
    >
      {code !== null ? (
        <p>
          <a href={`/join/${code}`}>Open captain sign-up</a> to invite teams. Captains submit their
          squad for your review; this link gives no club access.
        </p>
      ) : null}
      {error !== "" ? (
        <div className="tm-entry-error">
          <p role="alert">{error}</p>
          <Button
            variant="secondary"
            disabled={pending !== null}
            onClick={() => {
              router.refresh();
            }}
          >
            Refresh team status
          </Button>
        </div>
      ) : null}
      {entries.length === 0 ? (
        <p>No teams submitted yet. Share the captain sign-up link to collect squads.</p>
      ) : (
        [...entries]
          .sort(
            (a, b) =>
              Number(b.status === "submitted") - Number(a.status === "submitted") ||
              a.teamName.localeCompare(b.teamName) ||
              a.id.localeCompare(b.id),
          )
          .map((entry) => (
            <Card key={entry.id} className="tm-entry-card">
              <header className="tm-entry-head">
                <h3>{entry.teamName}</h3>
                <Pill
                  tone={
                    entry.status === "approved"
                      ? "green"
                      : entry.status === "submitted"
                        ? "gold"
                        : "neutral"
                  }
                >
                  {entry.status === "submitted"
                    ? "Awaiting review"
                    : entry.status === "approved"
                      ? "Approved"
                      : entry.status === "rejected"
                        ? "Rejected"
                        : entry.status}
                </Pill>
              </header>
              <p>
                {entry.players.length} players ·{" "}
                {entry.status === "approved"
                  ? "Squad added to the season"
                  : entry.status === "submitted"
                    ? "Approval adds this team and its players to the season"
                    : entry.status === "rejected"
                      ? "This squad has not been added to the season"
                      : "Review status shown above"}
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
                    disabled={pending !== null}
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
    </SectionCard>
  );
}
