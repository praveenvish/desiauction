"use client";

import { Button, Dialog, IconGavel, SectionCard, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { switchToOfflineResultsAction } from "../../../../server/auction/actions";

/**
 * "AUCTION HELD OFFLINE?" — the fork in the road, at the top of the Auction
 * tab while the night has not started (founder, BPL-4, 2026-10-07).
 *
 * The way to it used to be one grey sentence under the practice card pointing
 * at an "Abort" button at the foot of a long setup page — type ABORT, give a
 * reason — then Season details, then the Teams tab. Clubs run offline nights
 * often enough that it is a choice, not an emergency exit: one card, one
 * button, one plain confirmation of what changes and what does not.
 */
export function OfflineSwitch({
  slug,
  scheduled,
}: {
  slug: string;
  /** An auction is set up here (and will be ended); false = none created yet. */
  scheduled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();

  const confirm = () => {
    start(async () => {
      const result = await switchToOfflineResultsAction(slug);
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      setOpen(false);
      toast({ title: "Switched — type each player's points below.", tone: "success" });
      router.refresh();
    });
  };

  return (
    <SectionCard
      icon={<IconGavel />}
      title="Auction held offline?"
      description="If the auction happens — or already happened — outside DesiAuction, skip the live room and type the results in: each player's team and the points they went for. Your teams, captains and icons stay exactly as they are."
      data-testid="offline-switch"
      action={
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
          data-testid="offline-switch-open"
        >
          Switch to offline results
        </Button>
      }
    >
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Switch to offline results?"
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
            <Button onClick={confirm} loading={busy} data-testid="offline-switch-confirm">
              Switch to offline results
            </Button>
          </>
        }
      >
        <ul className="auc-switch-list">
          <li>
            <b>Kept:</b> every team, player, captain and icon — nothing on your team sheets changes.
          </li>
          <li>
            <b>Next:</b> this page becomes the results list. Type each player&apos;s points, then
            publish the teams to make the posters and squad sheets final.
          </li>
          {scheduled ? (
            <li>
              <b>Ended:</b> the live auction set up here and its practice. Owner invite links for it
              stop working. This can&apos;t be undone — you would set up a new auction instead.
            </li>
          ) : null}
        </ul>
      </Dialog>
    </SectionCard>
  );
}
