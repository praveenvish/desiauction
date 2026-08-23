"use client";

import { Button, Card, Dialog, Field, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { requestPassUpgrade, type SeasonPassView } from "../../../server/competition/pass";

/**
 * THE SEASON'S PASS, ON THE SEASON'S OWN PAGE.
 *
 * 0027 began refusing the fifth team on Free and there was nowhere to see a
 * limit before meeting it. A ceiling nobody can see is an ambush — you learn it
 * at the moment you are stopped, which is the worst moment to learn a
 * commercial fact. This card is there at 2 of 4 teams as much as at 4 of 4.
 *
 * The upgrade is a REQUEST and the card says so. Pro and Association both read
 * "Published at GA" on the pricing page: there is no price for either anywhere
 * in the product, and a checkout would have to invent the number an organizer
 * is charged. Promising "Upgrade" on a button that cannot take money would be
 * the same lie one screen later.
 */
export function SeasonPassCard({ slug, pass }: { slug: string; pass: SeasonPassView }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState("pro");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  // An uncounted pass has nothing to meter, and a progress bar against
  // "by agreement" would be a bar with no end. Say the fact instead.
  const uncounted = pass.teams.limit === null && pass.players.limit === null;

  const submit = () => {
    start(async () => {
      const result = await requestPassUpgrade(slug, tier, note);
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      setOpen(false);
      setNote("");
      toast({
        title: "Request sent. We'll come back to you — usually within a day.",
        tone: "success",
      });
      router.refresh();
    });
  };

  return (
    <Card className="season-pass-card" data-testid="season-pass">
      <div className="competition-head">
        <h2>Season pass</h2>
        <span className="season-pass-tier" data-testid="season-pass-tier">
          {pass.tierName}
        </span>
      </div>

      {uncounted ? (
        <p className="competitions-hint" data-testid="season-pass-uncounted">
          This season has no team or player limit. Tournaments started during beta keep every tier
          and every feature, free, for good.
        </p>
      ) : (
        <ul className="season-pass-meters">
          <Meter label="Teams" usage={pass.teams} testId="pass-meter-teams" />
          <Meter label="Players in the pool" usage={pass.players} testId="pass-meter-players" />
        </ul>
      )}

      {pass.pending !== null ? (
        <p className="teams-notice" role="status" data-testid="season-pass-pending">
          You&apos;ve asked for a bigger pass. We&apos;re on it — we&apos;ll come back to you before
          you need it.
        </p>
      ) : null}

      {pass.viewer.canRequest && pass.pending === null && !uncounted ? (
        <div className="season-pass-actions">
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(true);
            }}
            data-testid="open-pass-request"
          >
            Ask for more room
          </Button>
        </div>
      ) : null}

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Ask for a bigger pass"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={submit} loading={pending} data-testid="send-pass-request">
              Send request
            </Button>
          </>
        }
      >
        <div className="teams-dialog-form">
          {/* Said before the form, not after the submit: nothing here takes a
              payment, and an organizer deciding whether to click deserves to
              know that while they are deciding. */}
          <p className="competitions-hint">
            Passes aren&apos;t on sale yet — prices are published at general availability. Tell us
            what you need and we&apos;ll set it up on this season and confirm by email, usually
            within a day.
          </p>
          <Select
            label="Which pass?"
            name="tier"
            value={tier}
            onChange={(event) => {
              setTier(event.target.value);
            }}
          >
            <option value="pro">Pro Pass — up to 16 teams and 400 players</option>
            <option value="association">Association — a season&apos;s worth, by agreement</option>
          </Select>
          <Field
            label="What do you need it for? (optional)"
            name="note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            help="How many teams and players you expect, and when your auction is."
          />
        </div>
      </Dialog>
    </Card>
  );
}

function Meter({
  label,
  usage,
  testId,
}: {
  label: string;
  usage: SeasonPassView["teams"];
  testId: string;
}) {
  const limit = usage.limit;
  const pct = limit === null || limit === 0 ? 0 : Math.min(100, (usage.used / limit) * 100);
  return (
    <li
      className="season-pass-meter"
      data-testid={testId}
      data-full={usage.full ? "true" : undefined}
    >
      <span className="season-pass-meter-label">{label}</span>
      <span className="season-pass-meter-count">
        {usage.used}
        {limit === null ? "" : ` / ${String(limit)}`}
      </span>
      {limit === null ? null : (
        <span
          className="season-pass-bar"
          role="img"
          aria-label={`${label}: ${String(usage.used)} of ${String(limit)} used`}
        >
          <span className="season-pass-bar-fill" style={{ width: `${String(pct)}%` }} />
        </span>
      )}
      {usage.full ? (
        <span className="season-pass-meter-note">Full — ask for more room to add another.</span>
      ) : null}
    </li>
  );
}
