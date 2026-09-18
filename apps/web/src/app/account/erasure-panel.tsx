"use client";

import { Badge, Button, Dialog, Field, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import {
  requestErasureAction,
  withdrawErasureAction,
  type ErasureFormState,
} from "../../server/privacy/actions";
import type { MyErasureRequest } from "../../server/privacy/requests";

/**
 * "Delete my account" — as a request somebody answers, not a button that fires.
 *
 * The consequences are stated before anything is sent, in the same terms the
 * Data Retention policy uses, and a tick box says the person read them. An open
 * request can be taken back until the desk acts on it; a declined one shows the
 * reason, because a refusal nobody explains is a refusal nobody can contest.
 */
export function ErasurePanel({ request }: { request: MyErasureRequest | null }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [withdrawing, startWithdraw] = useTransition();
  // The follow-up (close, confirm, refresh) runs in the action itself, once per
  // submission, rather than in an effect watching `state` for a change.
  const [state, formAction, pending] = useActionState<ErasureFormState, FormData>(
    async (previous, form) => {
      const next = await requestErasureAction(previous, form);
      if (next.filed === true) {
        setOpen(false);
        toast({ title: "Request sent. We reply within seven days.", tone: "success" });
        router.refresh();
      }
      return next;
    },
    {},
  );

  if (request !== null && request.status === "requested") {
    return (
      <div className="account-erasure" data-testid="erasure-pending">
        <p className="account-prose">
          <Badge tone="warning">Deletion requested</Badge> You asked on{" "}
          {request.requestedAt.toISOString().slice(0, 10)}. We reply within seven days; until then
          you can take it back.
        </p>
        <Button
          variant="secondary"
          loading={withdrawing}
          onClick={() => {
            startWithdraw(async () => {
              const result = await withdrawErasureAction();
              toast({
                title: result.ok ? "Request withdrawn." : "That request has already been decided.",
                tone: result.ok ? "success" : "danger",
              });
              router.refresh();
            });
          }}
          data-testid="erasure-withdraw"
        >
          Withdraw request
        </Button>
      </div>
    );
  }

  return (
    <div className="account-erasure">
      {request?.status === "declined" && request.decisionNote !== null ? (
        <p className="account-prose" role="note" data-testid="erasure-declined">
          <Badge tone="neutral">Not deleted</Badge> Your request from{" "}
          {request.requestedAt.toISOString().slice(0, 10)} was declined: {request.decisionNote} You
          can ask again at any time.
        </p>
      ) : null}
      <Button
        variant="secondary"
        onClick={() => {
          setUnderstood(false);
          setOpen(true);
        }}
        data-testid="erasure-open"
      >
        Delete my account…
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Delete your account?"
      >
        <form action={formAction} className="account-erasure-form">
          <p>
            We delete your profile, your sign-in devices and your photo, and remove your name,
            number and email from every club you are in. Your registrations, bids and receipts stay
            in those clubs&rsquo; records, without your name. You will be signed out everywhere, and
            it cannot be undone.
          </p>
          <Field label="Anything we should know? (optional)" name="reason" maxLength={1000} />
          <label className="account-erasure-check">
            <input
              type="checkbox"
              name="understood"
              value="yes"
              checked={understood}
              onChange={(event) => {
                setUnderstood(event.target.checked);
              }}
              data-testid="erasure-understood"
            />
            <span>I understand this deletes my account and cannot be undone.</span>
          </label>
          {state.error !== undefined ? (
            <p role="alert" className="register-error">
              {state.error}
            </p>
          ) : null}
          <div className="account-erasure-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setOpen(false);
              }}
            >
              Keep my account
            </Button>
            <Button
              variant="danger"
              type="submit"
              loading={pending}
              disabled={!understood}
              data-testid="erasure-submit"
            >
              Request deletion
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
