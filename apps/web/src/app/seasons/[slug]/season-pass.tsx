"use client";

import { Button, Dialog, Field, IconCrown, Pill, Select, useToast } from "@desiauction/ui";
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

  // The body exists only when it has something to say: an uncounted pass is
  // one sentence, and that sentence is the card's description.
  return (
    <>
      {/* One line under "How the season looks", not a card of its own: which
          pass, how full it is, and the one thing to do about it. */}
      <div className="ov-pass" data-testid="season-pass">
        <span className="ov-pass-icon" aria-hidden>
          <IconCrown size={18} />
        </span>
        <span className="ov-pass-text">
          <span className="ov-pass-tier">
            <Pill tone="neutral" testId="season-pass-tier">
              {pass.tierName}
            </Pill>{" "}
            pass
          </span>
          {uncounted ? (
            <span data-testid="season-pass-uncounted">
              No team or player limit — tournaments started during beta keep every tier, free, for
              good.
            </span>
          ) : (
            <span>
              <Usage label="teams" usage={pass.teams} testId="pass-meter-teams" /> ·{" "}
              <Usage label="players" usage={pass.players} testId="pass-meter-players" />
            </span>
          )}
          {pass.pending !== null ? (
            <span role="status" data-testid="season-pass-pending">
              You&apos;ve asked for a bigger pass — we&apos;ll come back to you before you need it.
            </span>
          ) : null}
        </span>
        {pass.viewer.canRequest && pass.pending === null && !uncounted ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(true);
            }}
            data-testid="open-pass-request"
          >
            Ask for more room
          </Button>
        ) : null}
      </div>

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
    </>
  );
}

/** "teams 4 of 4 (full)" — one usage, said in words. */
function Usage({
  label,
  usage,
  testId,
}: {
  label: string;
  usage: SeasonPassView["teams"];
  testId: string;
}) {
  const limit = usage.limit;
  return (
    <span className="ov-pass-usage" data-full={usage.full ? "" : undefined} data-testid={testId}>
      {label} {usage.used}
      {limit === null ? "" : ` of ${String(limit)}`}
      {usage.full ? " — full" : ""}
    </span>
  );
}
