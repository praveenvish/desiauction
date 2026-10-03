"use client";

import {
  PRACTICE_BASE_POINTS,
  PRACTICE_PURSE_POINTS,
  practiceLotCount,
  type PracticeSquadSize,
} from "@desiauction/core";
import {
  Button,
  ButtonLink,
  Dialog,
  Pill,
  SectionCard,
  useToast,
  type KitTone,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  endPracticeAction,
  runPracticeAgainAction,
  startPracticeAction,
  type PracticeCard as PracticeCardView,
  type PracticeTeamState,
} from "../../../../server/auction/practice-actions";

const STATE_WORDS: Record<PracticeTeamState, { label: string; tone: KitTone }> = {
  ready: { label: "Ready to bid", tone: "green" },
  waiting: { label: "Not bidding yet", tone: "amber" },
  organiser: { label: "You bid for this team", tone: "neutral" },
};

const STATUS_LINE: Record<string, string> = {
  scheduled:
    "Ready. Ask your owners to open their usual auction link — they'll land in the practice. Then open the cockpit and start it.",
  live: "Running now. Owners are bidding with pretend points.",
  paused: "Paused.",
};

/**
 * THE PRACTICE AUCTION CARD (0101) — the organiser's whole control for it.
 *
 * Before: one choice (2 or 3 players per team), the sum it makes, and Start.
 * During: who has arrived, the cockpit, Run again, End. Nothing to set up:
 * teams, owners, timer and rules come from the real auction.
 */
export function PracticeCard({ slug, card }: { slug: string; card: PracticeCardView }) {
  const router = useRouter();
  const toast = useToast();
  const [perTeam, setPerTeam] = useState<PracticeSquadSize>(2);
  const [busy, setBusy] = useState<"start" | "again" | "end" | null>(null);
  const [confirm, setConfirm] = useState<"again" | "end" | null>(null);
  const practice = card.practice;

  const run = async (
    kind: "start" | "again" | "end",
    act: () => Promise<{ ok: true } | { ok: false; error: string }>,
    done: string,
  ) => {
    setBusy(kind);
    try {
      const result = await act();
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      setConfirm(null);
      toast({ title: done, tone: "success" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const players = practiceLotCount(card.teamCount, perTeam);
  const joined = practice?.teams.filter((team) => team.state === "ready").length ?? 0;
  const withOwners = practice?.teams.filter((team) => team.state !== "organiser").length ?? 0;

  return (
    <SectionCard
      title="Practice auction"
      tone="amber"
      description="A 10-minute rehearsal before the real night, so every owner learns the bidding on their own phone. Same link, same screens — nothing counts."
      data-testid="practice-card"
    >
      {practice === null ? (
        card.blocked !== null ? (
          <p className="competitions-hint" data-testid="practice-blocked">
            {card.blocked}
          </p>
        ) : (
          <div className="practice-setup">
            <div className="practice-size" role="group" aria-label="Players per team">
              <span className="practice-size-label">Players per team</span>
              {([2, 3] as const).map((size) => (
                <Button
                  key={size}
                  size="sm"
                  variant={perTeam === size ? "primary" : "secondary"}
                  aria-pressed={perTeam === size}
                  onClick={() => {
                    setPerTeam(size);
                  }}
                  data-testid={`practice-size-${String(size)}`}
                >
                  {size}
                </Button>
              ))}
            </div>
            <p className="practice-sum" data-testid="practice-sum">
              {card.teamCount} teams × {perTeam} + 2 extra = <strong>{players} players</strong> ·{" "}
              {PRACTICE_PURSE_POINTS} points per team · every player starts at{" "}
              {PRACTICE_BASE_POINTS}
            </p>
            <p className="competitions-hint">
              The 2 extra players can&apos;t all be bought, so owners also see what
              &ldquo;unsold&rdquo; looks like. With only {PRACTICE_PURSE_POINTS} points, spending
              big on one player leaves too little for the rest — the lesson that matters most on the
              night.
              {card.playerCount < players
                ? ` Your season has ${String(card.playerCount)} players, so the practice uses all of them.`
                : ""}
            </p>
            <Button
              onClick={() =>
                void run(
                  "start",
                  () => startPracticeAction(slug, perTeam),
                  "Practice ready — ask your owners to open their auction link",
                )
              }
              loading={busy === "start"}
              data-testid="practice-start"
            >
              Start practice
            </Button>
          </div>
        )
      ) : (
        <div className="practice-running" data-testid="practice-running">
          <p data-testid="practice-status">
            <strong>
              {practice.lotCount} players · {practice.perTeam} per team
            </strong>{" "}
            — {STATUS_LINE[practice.status] ?? ""}
          </p>
          {withOwners > 0 ? (
            <p className="competitions-hint" data-testid="practice-joined">
              {joined} of {withOwners} owners ready to bid. Owners pick up their paddle in the room,
              as on the night.
            </p>
          ) : null}
          <ul className="practice-teams" data-testid="practice-teams">
            {practice.teams.map((team) => (
              <li key={team.id}>
                <span className="practice-team-name">
                  {team.name}
                  {team.ownerName !== null ? (
                    <span className="competitions-hint"> · {team.ownerName}</span>
                  ) : null}
                </span>
                <Pill tone={STATE_WORDS[team.state].tone}>{STATE_WORDS[team.state].label}</Pill>
              </li>
            ))}
          </ul>
          <p className="competitions-hint">
            A practice with nothing happening for an hour ends by itself, and starting the real
            auction ends it too.
          </p>
          <div className="practice-actions">
            <ButtonLink href={`/seasons/${slug}/auction/cockpit`} data-testid="practice-cockpit">
              Open the cockpit
            </ButtonLink>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirm("again");
              }}
              data-testid="practice-again"
            >
              Run again
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirm("end");
              }}
              data-testid="practice-end"
            >
              End practice
            </Button>
          </div>
        </div>
      )}
      <Dialog
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
        }}
        title={confirm === "again" ? "Run the practice again?" : "End the practice?"}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirm(null);
              }}
            >
              Cancel
            </Button>
            {confirm === "again" ? (
              <Button
                onClick={() =>
                  void run("again", () => runPracticeAgainAction(slug), "A fresh practice is ready")
                }
                loading={busy === "again"}
                data-testid="confirm-practice-again"
              >
                Run again
              </Button>
            ) : (
              <Button
                onClick={() => void run("end", () => endPracticeAction(slug), "Practice ended")}
                loading={busy === "end"}
                data-testid="confirm-practice-end"
              >
                End practice
              </Button>
            )}
          </>
        }
      >
        <p>
          {confirm === "again"
            ? "Everyone starts over with full purses and the same players. Owners stay where they are — their screens move to the new practice by themselves."
            : "Everyone in the practice moves to the real auction's waiting room. You can start another practice any time before the real auction."}
        </p>
      </Dialog>
    </SectionCard>
  );
}
