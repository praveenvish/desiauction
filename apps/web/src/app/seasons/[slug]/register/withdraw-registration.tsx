"use client";

import { Button, Dialog } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { withdrawMyRegistrationAction } from "../../../../server/competition/actions";

/**
 * DA-35: a player could not withdraw. `withdraw` was a declared transition with
 * no caller, `withdrawn` sat in the organizer's filter unreachable, and someone
 * who pulled out was filed as REJECTED with reason "withdrew" — told "this
 * wasn't approved this time" about a decision they made themselves.
 *
 * Withdrawal is not a triage outcome. It is the player's own act, so it lives
 * on the player's page and asks them once, plainly, before it happens.
 */
export function WithdrawRegistration({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withdraw = async () => {
    setBusy(true);
    setError(null);
    const result = await withdrawMyRegistrationAction(slug);
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? "That didn't work. Try again.");
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        data-testid="withdraw-registration"
        onClick={() => {
          setOpen(true);
        }}
      >
        Withdraw my registration
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Withdraw your registration?"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Keep my registration
            </Button>
            <Button
              variant="danger"
              loading={busy}
              data-testid="confirm-withdraw"
              onClick={() => void withdraw()}
            >
              Withdraw
            </Button>
          </>
        }
      >
        <p>
          You&apos;ll be taken out of this season — out of the player pool and out of the auction.
          The organizer is told you withdrew, not that you were turned down.
        </p>
        <p>
          You can register again while registration is still open, or ask the organizer to put you
          back.
        </p>
        {error !== null ? (
          <p role="alert" className="register-error">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
