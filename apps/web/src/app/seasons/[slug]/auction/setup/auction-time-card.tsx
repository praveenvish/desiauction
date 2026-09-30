"use client";

import { Button, Field, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatDateTime } from "../../../../../lib/format-date";
import { toIstLocal } from "../../../../../lib/ist-time";
import { setAuctionStartAction } from "../../../../../server/competition/actions";
import { release } from "../../../../../lib/release";

/**
 * WHEN IS AUCTION NIGHT? (0095) — the one place the time is set.
 *
 * Everyone who can see the setup sees the time; the season's managers can set,
 * move or clear it. The field is India time whatever the reader's own clock
 * says (lib/ist-time.ts), and the note says what happens next: owners and pool
 * players are emailed ten minutes after the last change, so a typo fixed at
 * once reaches nobody.
 */
export function AuctionTimeCard({
  slug,
  startsAt,
  canEdit,
  locked,
}: {
  slug: string;
  /** ISO moment, or null when not set. */
  startsAt: string | null;
  /** competition.manage */
  canEdit: boolean;
  /** The auction has opened: the room is the truth now. */
  locked: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(startsAt === null ? "" : toIstLocal(new Date(startsAt)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: string) {
    setBusy(true);
    setError(null);
    const result = await release(setAuctionStartAction(slug, next), () => {
      setBusy(false);
    });
    if (!result.ok) {
      setError(result.error ?? "That didn't save. Try again.");
      return;
    }
    setValue(next);
    toast({
      tone: "success",
      title: next === "" ? "Auction time cleared" : "Auction time saved",
      description: "Owners and pool players get an email in ten minutes.",
    });
    router.refresh();
  }

  const shown = startsAt === null ? null : `${formatDateTime(startsAt)} IST`;
  return (
    <section className="as-time" aria-labelledby="as-time-title" data-testid="auction-time">
      <div className="as-time-head">
        <h3 id="as-time-title">Auction night</h3>
        <p className="as-time-value" data-testid="auction-time-value">
          {shown ?? "Not set yet"}
        </p>
      </div>
      {canEdit && !locked ? (
        <form
          className="as-time-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(value);
          }}
        >
          <Field
            label="Date and time (IST)"
            name="auctionStartsAt"
            type="datetime-local"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            {...(error === null ? {} : { error })}
          />
          <div className="as-time-actions">
            <Button type="submit" loading={busy} disabled={value === ""}>
              {startsAt === null ? "Set the time" : "Save the new time"}
            </Button>
            {startsAt !== null ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void save("");
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
          <p className="as-time-note">
            Owners and players in the pool get an email ten minutes after your last change, so you
            can fix a mistake before anyone sees it.
          </p>
        </form>
      ) : null}
    </section>
  );
}
