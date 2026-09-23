"use client";

import { Button, Dialog, Field, IconAlert, Notice, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  revertNotificationSwitch,
  setChannelSwitch,
  setControllability,
  setNotificationSwitch,
  type NotificationActionResult,
} from "../../../server/admin/notification-actions";

/**
 * The only interactive pieces of /admin/notifications. Everything else on the
 * page is a server render of the projection; these islands call one action
 * each, say what happened in a toast, and refresh the page so every chip, count
 * and recent change is the server's answer rather than an optimistic guess.
 */

const SECURITY_REASON_MIN = 10;
const REASON_MAX = 500;

function useRun() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (act: () => Promise<NotificationActionResult>, onDone?: () => void) => {
    start(async () => {
      const result = await act();
      if (!result.ok) {
        toast({ title: result.error, tone: "danger" });
        return;
      }
      toast({ title: result.message, tone: "success" });
      onDone?.();
      router.refresh();
    });
  };
  return { pending, run };
}

/**
 * One kind on one channel. A security alert does not switch off on a click:
 * it opens a dialog that says what is lost and will not submit without a
 * written reason. A sign-in code has no toggle at all — the cell is `locked`.
 */
export function SwitchToggle({
  kind,
  kindLabel,
  channel,
  channelLabel,
  enabled,
  needsReason,
}: {
  kind: string;
  kindLabel: string;
  channel: string;
  channelLabel: string;
  enabled: boolean;
  needsReason: boolean;
}) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const length = reason.trim().length;
  const valid = length >= SECURITY_REASON_MIN && length <= REASON_MAX;
  const id = `notify-cell-${kind}-${channel}`;
  return (
    <>
      <label className="notify-switch ntc-toggle" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={enabled}
          disabled={pending}
          data-testid={id}
          onChange={(event) => {
            const next = event.target.checked;
            if (!next && needsReason) {
              setReason("");
              setOpen(true);
              return;
            }
            run(() => setNotificationSwitch(kind, channel, next));
          }}
        />
        <span className="notify-switch-label">
          {channelLabel}
          <span className="admin-sr-only"> for {kindLabel}</span>
        </span>
      </label>
      {needsReason ? (
        <Dialog
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title={`Switch off ${kindLabel} on ${channelLabel}?`}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={pending}
                disabled={!valid}
                onClick={() => {
                  run(
                    () => setNotificationSwitch(kind, channel, false, reason),
                    () => {
                      setOpen(false);
                    },
                  );
                }}
                data-testid="notify-reason-confirm"
              >
                Switch it off
              </Button>
            </>
          }
        >
          <Notice tone="danger" icon={<IconAlert size={20} />} testId="notify-security-warning">
            This is a security alert. While it is off, a person whose mobile number or sign-in email
            is changed — by them or by someone who got into their account — is not warned on{" "}
            {channelLabel}. Clubs and people can never switch it off; only you can, and your reason
            is kept on the audit log against your name.
          </Notice>
          <Field
            label="Reason"
            name={`notify-reason-${kind}-${channel}`}
            value={reason}
            required
            maxLength={REASON_MAX}
            autoComplete="off"
            data-testid="notify-reason-input"
            help={`Why it must stop, and until when. At least ${String(SECURITY_REASON_MIN)} characters.`}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Dialog>
      ) : null}
    </>
  );
}

/** "People can turn this off" / "Clubs can turn this off" — only where the catalogue allows. */
export function ControlToggle({
  kind,
  kindLabel,
  side,
  effective,
}: {
  kind: string;
  kindLabel: string;
  side: "person" | "org";
  effective: boolean;
}) {
  const { pending, run } = useRun();
  const id = `notify-${side}-${kind}`;
  const label = side === "person" ? "People can turn this off" : "Clubs can turn this off";
  return (
    <label className="notify-switch ntc-toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={effective}
        disabled={pending}
        data-testid={id}
        onChange={(event) => {
          const next = event.target.checked;
          run(() =>
            setControllability(
              kind,
              undefined,
              side === "person" ? next : undefined,
              side === "org" ? next : undefined,
            ),
          );
        }}
      />
      <span className="notify-switch-text">
        <span className="notify-switch-label">
          {label}
          <span className="admin-sr-only"> — {kindLabel}</span>
        </span>
      </span>
    </label>
  );
}

/**
 * A whole channel. Switching one off asks first, with an optional reason the
 * rest of the team reads on the strip; switching it back on does not.
 */
export function ChannelControl({
  channel,
  label,
  enabled,
}: {
  channel: string;
  label: string;
  enabled: boolean;
}) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!enabled) {
    return (
      <Button
        variant="secondary"
        size="touch"
        loading={pending}
        onClick={() => {
          run(() => setChannelSwitch(channel, true));
        }}
        data-testid={`notify-channel-on-${channel}`}
      >
        Switch {label} back on
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="secondary"
        size="touch"
        onClick={() => {
          setReason("");
          setOpen(true);
        }}
        data-testid={`notify-channel-off-${channel}`}
      >
        Switch {label} off…
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={`Switch ${label} off everywhere?`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={reason.trim().length > REASON_MAX}
              onClick={() => {
                run(
                  () => setChannelSwitch(channel, false, reason),
                  () => {
                    setOpen(false);
                  },
                );
              }}
              data-testid="notify-channel-confirm"
            >
              Switch {label} off
            </Button>
          </>
        }
      >
        <p>
          Every message on {label} stops, for every club and every person, until it is switched back
          on. Texts that can go by SMS instead still do. Login codes are never stopped.
        </p>
        <Field
          label="Reason (optional)"
          name={`notify-channel-reason-${channel}`}
          value={reason}
          maxLength={REASON_MAX}
          autoComplete="off"
          help="Shown on the strip and kept on the audit log — for example, a provider incident."
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </Dialog>
    </>
  );
}

export function RevertButton({ auditId, summary }: { auditId: string; summary: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="secondary"
      size="touch"
      loading={pending}
      onClick={() => {
        run(() => revertNotificationSwitch(auditId));
      }}
      aria-label={`Revert: ${summary}`}
      data-testid={`notify-revert-${auditId}`}
    >
      Revert
    </Button>
  );
}
