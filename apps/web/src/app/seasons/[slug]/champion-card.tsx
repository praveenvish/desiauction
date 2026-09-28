"use client";

import { Button, Dialog, IconTrophy, SectionCard, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { announceChampionAction } from "../../../server/competition/fixture-actions";
import type { FinaleState } from "../../../server/competition/season-finale";

function people(count: number): string {
  return count === 1 ? "1 person" : `${String(count)} people`;
}

function points(n: number): string {
  return `${String(n)} ${n === 1 ? "pt" : "pts"}`;
}

/**
 * NAME THE CHAMPION (email programme PR12). Offered once every match is played
 * or called off. The top of the table is chosen for the organizer, who may
 * pick another team — a final played off the app, a tie at the top. Announcing
 * tells every player, owner and organizer, once, so it asks first.
 */
export function ChampionCard({ slug, state }: { slug: string; state: FinaleState }) {
  const router = useRouter();
  const toast = useToast();
  const [teamId, setTeamId] = useState(state.table[0]?.teamId ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (state.announced !== null) {
    return (
      <SectionCard
        data-testid="champion-card"
        icon={<IconTrophy />}
        tone="green"
        title={`Champions: ${state.announced.teamName}`}
        description={
          <span data-testid="champion-announced">
            Announced{" "}
            {state.announced.at.toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              timeZone: "Asia/Kolkata",
            })}
            . Every player, owner and organizer was told by email and in their inbox.
          </span>
        }
      />
    );
  }

  const chosen = state.table.find((row) => row.teamId === teamId);
  const announce = async () => {
    setBusy(true);
    const result = await announceChampionAction(slug, teamId);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast({ title: result.error ?? "Could not announce.", tone: "danger" });
      return;
    }
    toast({
      title: `${chosen?.teamName ?? "The champion"} announced — ${people(result.told ?? 0)} told.`,
      tone: "success",
    });
    router.refresh();
  };

  return (
    <>
      <SectionCard
        data-testid="champion-card"
        icon={<IconTrophy />}
        tone="gold"
        title="Name your champion"
        description={
          state.tiedAtTop
            ? "Every match is done, and the top two finished level. Choose the champion — the team that won the final, or however your rules settle it."
            : "Every match is done. The top of the table is chosen for you; pick another team if the title was decided another way, such as a final."
        }
      >
        <div className="ov-champion">
          <Select
            label="Champion"
            value={teamId}
            onChange={(event) => {
              setTeamId(event.target.value);
            }}
            data-testid="champion-team"
          >
            {state.table.map((row, i) => (
              <option key={row.teamId} value={row.teamId}>
                {`${String(i + 1)}. ${row.teamName} · ${points(row.points)}`}
              </option>
            ))}
          </Select>
          <Button
            onClick={() => {
              setConfirming(true);
            }}
            disabled={teamId === ""}
            data-testid="champion-announce"
          >
            <IconTrophy size={18} className="icon-lead" aria-hidden />
            Announce the champion
          </Button>
        </div>
      </SectionCard>
      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title={`Announce ${chosen?.teamName ?? "the champion"}?`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Not yet
            </Button>
            <Button onClick={() => void announce()} loading={busy} data-testid="champion-confirm">
              Announce
            </Button>
          </>
        }
      >
        <p className="competitions-hint">
          Every player and owner in the season hears it now — the champions get a celebration, every
          other team where they finished — and your organizers get the final table. It can&apos;t be
          taken back.
        </p>
      </Dialog>
    </>
  );
}
