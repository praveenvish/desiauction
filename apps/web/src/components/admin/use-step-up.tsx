"use client";

import { Button, Dialog, Field } from "@desiauction/ui";
import { useRef, useState, type ReactNode } from "react";

import { confirmStepUpAction, requestStepUpAction } from "../../server/auth/step-up-actions";

/** What a step-up-gated admin action answers. `stepUp` asks for "Confirm it's you". */
export type GatedResult = { ok: true } | { ok: false; error: string; stepUp?: boolean };

type Phase =
  | { at: "closed" }
  | { at: "sending" }
  | { at: "code"; sentTo: string; error?: string }
  | { at: "checking"; sentTo: string };

/**
 * "CONFIRM IT'S YOU" (AC-1.1) — wrap a risky admin action in `run`.
 *
 * The server decides: an action answers `{ stepUp: true }` when this session
 * has no fresh code. Then — and only then — the dialog opens, sends a code to
 * the operator's own email (or phone) straight away, takes the six digits and
 * runs the SAME action again. One code covers ten minutes of work, so a run
 * of related actions asks once. Cancelling leaves nothing half-done: the
 * action was refused before it wrote anything.
 */
export function useStepUp(): {
  run: (action: () => Promise<GatedResult>) => Promise<GatedResult>;
  dialog: ReactNode;
} {
  const [phase, setPhase] = useState<Phase>({ at: "closed" });
  const [code, setCode] = useState("");
  // The action waiting for the code, and how to hand its final answer back.
  const pending = useRef<{
    action: () => Promise<GatedResult>;
    settle: (result: GatedResult) => void;
  } | null>(null);

  const send = async () => {
    setPhase({ at: "sending" });
    let sent;
    try {
      sent = await requestStepUpAction();
    } catch {
      // Never left on "Sending you a code…": the caller gets an answer.
      finish({
        ok: false,
        error: "We couldn't reach DesiAuction. Check your connection and try again.",
      });
      return;
    }
    if (!sent.ok) {
      finish({ ok: false, error: sent.error });
      return;
    }
    setCode("");
    setPhase({ at: "code", sentTo: sent.sentTo });
  };

  const finish = (result: GatedResult) => {
    setPhase({ at: "closed" });
    setCode("");
    pending.current?.settle(result);
    pending.current = null;
  };

  const run = async (action: () => Promise<GatedResult>): Promise<GatedResult> => {
    const first = await action();
    if (first.ok || first.stepUp !== true) {
      return first;
    }
    return new Promise<GatedResult>((settle) => {
      pending.current = { action, settle };
      void send();
    });
  };

  const confirm = async (sentTo: string) => {
    setPhase({ at: "checking", sentTo });
    try {
      const checked = await confirmStepUpAction(code);
      if (!checked.ok) {
        setPhase({ at: "code", sentTo, error: checked.error });
        return;
      }
      const action = pending.current?.action;
      finish(action === undefined ? { ok: false, error: "Try again." } : await action());
    } catch {
      finish({
        ok: false,
        error: "Something went wrong before that finished. Check the page, then try again.",
      });
    }
  };

  const open = phase.at !== "closed";
  const sentTo = phase.at === "code" || phase.at === "checking" ? phase.sentTo : null;
  const dialog = (
    <Dialog
      open={open}
      onClose={() => {
        finish({ ok: false, error: "Cancelled — nothing was changed." });
      }}
      title="Confirm it's you"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              finish({ ok: false, error: "Cancelled — nothing was changed." });
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (sentTo !== null) {
                void confirm(sentTo);
              }
            }}
            loading={phase.at === "checking"}
            disabled={sentTo === null || !/^\d{6}$/.test(code)}
            data-testid="step-up-confirm"
          >
            Confirm
          </Button>
        </>
      }
    >
      {sentTo === null ? (
        <p>Sending you a code…</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (/^\d{6}$/.test(code)) {
              void confirm(sentTo);
            }
          }}
        >
          <p>
            This changes someone else&apos;s account, so we need to be sure it&apos;s you. We sent a
            6-digit code to <strong>{sentTo}</strong>. It works for 10 minutes, and one code covers
            everything you do in that time.
          </p>
          <Field
            label="6-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            {...(phase.at === "code" && phase.error !== undefined ? { error: phase.error } : {})}
            data-testid="step-up-code"
            autoFocus
          />
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => void send()}
            disabled={phase.at === "checking"}
          >
            Send a new code
          </Button>
        </form>
      )}
    </Dialog>
  );
  return { run, dialog };
}
