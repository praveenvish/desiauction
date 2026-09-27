"use client";

import {
  Button,
  Dialog,
  Field,
  IconKebab,
  IconShieldCheck,
  Notice,
  PopoverMenu,
  useToast,
} from "@desiauction/ui";
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
  const run = (
    act: () => Promise<NotificationActionResult>,
    onDone?: () => void,
    onFail?: () => void,
  ) => {
    start(async () => {
      const result = await act();
      if (!result.ok) {
        onFail?.();
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
 * A switch moves when it is clicked. Bound only to the server's answer it sat
 * still for the whole save-and-refresh, which reads as a click that did nothing
 * (and invites a second). The intent is kept WITH the server value it was made
 * against, so it lapses on its own the moment refreshed props differ — no
 * effect, no reset — and `clear` drops it when the action is refused.
 */
function useIntended(server: boolean) {
  const [intent, setIntent] = useState<{ value: boolean; against: boolean } | null>(null);
  const shown = intent !== null && intent.against === server ? intent.value : server;
  return {
    shown,
    intend: (value: boolean) => {
      setIntent({ value, against: server });
    },
    clear: () => {
      setIntent(null);
    },
  };
}

/**
 * One kind on one channel. A security alert does not switch off on a click:
 * it opens a dialog that says what stops and who stops being warned, and will
 * not submit without a written reason (10–500 characters). A sign-in code has
 * no toggle at all — the cell is `locked`.
 *
 * A switch in the eyes of assistive tech (role="switch" on the checkbox),
 * named for the message AND the channel: the panel's row shows the channel,
 * the name says both.
 */
export function SwitchToggle({
  kind,
  kindLabel,
  kindDescription,
  channel,
  channelLabel,
  enabled,
  needsReason,
  describedBy,
}: {
  kind: string;
  kindLabel: string;
  /** The id of the words beside the switch that say what it means. */
  describedBy?: string;
  /** What the message does — the security confirm says it before asking why. */
  kindDescription: string;
  channel: string;
  channelLabel: string;
  enabled: boolean;
  needsReason: boolean;
}) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { shown, intend, clear } = useIntended(enabled);
  const length = reason.trim().length;
  const valid = length >= SECURITY_REASON_MIN && length <= REASON_MAX;
  const id = `notify-cell-${kind}-${channel}`;
  return (
    <>
      <label className="ntc-toggle" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={shown}
          disabled={pending}
          aria-describedby={describedBy}
          data-testid={id}
          onChange={(event) => {
            const next = event.target.checked;
            if (!next && needsReason) {
              setReason("");
              setOpen(true);
              return;
            }
            intend(next);
            run(() => setNotificationSwitch(kind, channel, next), undefined, clear);
          }}
        />
        <span className="admin-sr-only">
          {kindLabel} on {channelLabel}
        </span>
      </label>
      {needsReason ? (
        <Dialog
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title={`Stop “${kindLabel}” on ${channelLabel}?`}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                }}
                data-testid="notify-reason-keep"
              >
                Keep it on
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
          <div className="ntc-confirm">
            <Notice
              tone="danger"
              icon={<IconShieldCheck size={20} />}
              title="This is a security message"
              testId="notify-security-warning"
            >
              {kindDescription} While it is off, nobody is warned on {channelLabel}. People and
              clubs can never stop it — only an admin can.
            </Notice>
            <Field
              label="Reason — why must it stop?"
              name={`notify-reason-${kind}-${channel}`}
              value={reason}
              required
              maxLength={REASON_MAX}
              autoComplete="off"
              placeholder="e.g. duplicates from the provider — back on after their fix"
              data-testid="notify-reason-input"
              help={`At least ${String(SECURITY_REASON_MIN)} characters. Kept on the audit log against your name; the whole admin team sees it.`}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

/** "People can turn it off" / "Clubs can turn it off" — only where the catalogue allows. */
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
  const { shown, intend, clear } = useIntended(effective);
  const id = `notify-${side}-${kind}`;
  const text =
    side === "person"
      ? "A person can turn it off for themselves"
      : "A club can turn it off for its players";
  return (
    <label className="ntc-toggle ntc-toggle-row" htmlFor={id}>
      <span className="ntc-toggle-text">
        {text}
        <span className="admin-sr-only"> — {kindLabel}</span>
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={shown}
        disabled={pending}
        data-testid={id}
        onChange={(event) => {
          const next = event.target.checked;
          intend(next);
          run(
            () =>
              setControllability(
                kind,
                undefined,
                side === "person" ? next : undefined,
                side === "org" ? next : undefined,
              ),
            undefined,
            clear,
          );
        }}
      />
    </label>
  );
}

/**
 * A whole channel's kill switch — an incident tool, so it lives in the card's
 * ⋯ menu rather than on the strip as a button. Switching off asks first, with
 * an optional reason the team reads on the card; switching back on is one
 * visible click, because that is the way out of an incident.
 */
export function ChannelControl({
  channel,
  label,
  enabled,
  links,
}: {
  channel: string;
  label: string;
  enabled: boolean;
  /** Where the channel's details live — analytics, templates. */
  links: readonly { label: string; href: string }[];
}) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="ntc-channel-actions">
      {enabled ? null : (
        <Button
          variant="secondary"
          size="sm"
          loading={pending}
          onClick={() => {
            run(() => setChannelSwitch(channel, true));
          }}
          data-testid={`notify-channel-on-${channel}`}
        >
          Switch back on
        </Button>
      )}
      <PopoverMenu
        label={`${label} options`}
        trigger={<IconKebab size={20} />}
        triggerClassName="ntc-kebab"
        items={[
          ...links.map((link) => ({
            key: link.href,
            label: link.label,
            href: link.href,
          })),
          ...(enabled
            ? [
                {
                  key: "off",
                  label: `Switch ${label} off everywhere…`,
                  danger: true,
                  testId: `notify-channel-off-${channel}`,
                  onSelect: () => {
                    setReason("");
                    setOpen(true);
                  },
                },
              ]
            : []),
        ]}
      />
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
              Keep it on
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
        <div className="ntc-confirm">
          <p>
            Every message on {label} stops, for every club and every person, until it is switched
            back on. Texts that can go by SMS instead still do. Sign-in codes are never stopped.
          </p>
          <Field
            label="Reason (optional)"
            name={`notify-channel-reason-${channel}`}
            value={reason}
            maxLength={REASON_MAX}
            autoComplete="off"
            help="Shown on the channel card and kept on the audit log — for example, a provider incident."
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </div>
      </Dialog>
    </div>
  );
}

export function RevertButton({ auditId, summary }: { auditId: string; summary: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="ghost"
      size="sm"
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
