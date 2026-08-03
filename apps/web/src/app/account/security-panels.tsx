"use client";

import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  finishPasskeyEnrollmentAction,
  removePasskeyAction,
  renamePasskeyAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  startPasskeyEnrollmentAction,
  type AccountSecurity,
  type SessionView,
} from "../../server/auth/actions";
import { formatDate, formatDateTime } from "../../lib/format-date";
import { isKnownEvent, labelForEvent } from "../../lib/inbox-events";

/** How many sessions and events render before "Show more". */
const PAGE = 10;

type Pending =
  | { kind: "revoke-session"; session: SessionView }
  | { kind: "revoke-others"; count: number }
  | { kind: "remove-passkey"; id: string; name: string }
  | { kind: "rename-passkey"; id: string; name: string };

export function SecurityPanels({ security }: { security: AccountSecurity }) {
  const router = useRouter();
  const toast = useToast();
  const [deviceName, setDeviceName] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionsShown, setSessionsShown] = useState(PAGE);
  const [eventsShown, setEventsShown] = useState(PAGE);
  const [pending, setPending] = useState<Pending | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const others = security.sessions.filter((entry) => !entry.current);

  const enroll = async () => {
    setEnrollError(null);
    if (deviceName.trim() === "") {
      // Validated BEFORE the ceremony: asking someone to touch their fingerprint
      // reader and only then telling them the form was incomplete is a wasted
      // biometric prompt.
      setEnrollError("Name this device first — you'll need to tell them apart.");
      return;
    }
    setBusy(true);
    try {
      const options = await startPasskeyEnrollmentAction();
      if (options === null) {
        setEnrollError("Your session has expired. Sign in again to add a passkey.");
        return;
      }
      const response = await startRegistration({ optionsJSON: options });
      const result = await finishPasskeyEnrollmentAction(response, deviceName);
      if (result.ok) {
        toast({
          title: "Passkey added",
          description: "You can now sign in without a code.",
          tone: "success",
        });
        setDeviceName("");
        router.refresh();
      } else {
        setEnrollError(result.error ?? "Passkey enrollment failed.");
        toast({ title: "Passkey enrollment failed", tone: "danger" });
      }
    } catch (cause) {
      // EVERY failure used to be reported as a cancellation. Reproduced:
      // enrolling a second passkey on an already-enrolled authenticator wrote no
      // row, logged no event, and told the user they had cancelled something
      // they had not — leaving them to try again forever. The three outcomes are
      // genuinely different and each needs its own sentence.
      const name = cause instanceof Error ? cause.name : "";
      if (name === "InvalidStateError") {
        setEnrollError(
          "This device already has a passkey for your account. It's in the list above — rename it rather than adding another.",
        );
        toast({ title: "This device is already enrolled", tone: "info" });
      } else if (name === "NotAllowedError" || name === "AbortError") {
        toast({ title: "Passkey enrollment cancelled", tone: "info" });
      } else {
        setEnrollError(
          "Your device couldn't create a passkey. Check your screen lock is set up, then try again.",
        );
        toast({ title: "Passkey enrollment failed", tone: "danger" });
      }
    } finally {
      setBusy(false);
    }
  };

  const closeDialog = () => {
    setPending(null);
    setDialogError(null);
    setRenameTo("");
  };

  /** Run a confirmed action, and REPORT what came back — including failure. */
  const confirm = async () => {
    if (pending === null) {
      return;
    }
    setWorking(true);
    setDialogError(null);
    try {
      if (pending.kind === "revoke-session") {
        const result = await revokeSessionAction(pending.session.id);
        if (!result.ok) {
          setDialogError(result.error ?? "That didn't work. Try again.");
          return;
        }
        toast({ title: "Device signed out", tone: "success" });
      } else if (pending.kind === "revoke-others") {
        const result = await revokeOtherSessionsAction();
        if (!result.ok) {
          setDialogError(result.error ?? "That didn't work. Try again.");
          return;
        }
        const count = result.revoked ?? 0;
        toast({
          title:
            count === 1 ? "1 other device signed out" : `${String(count)} other devices signed out`,
          description: "This device is still signed in.",
          tone: "success",
        });
      } else if (pending.kind === "remove-passkey") {
        const result = await removePasskeyAction(pending.id);
        if (!result.ok) {
          setDialogError(result.error ?? "That didn't work. Try again.");
          return;
        }
        toast({ title: "Passkey removed", tone: "success" });
      } else {
        const result = await renamePasskeyAction(pending.id, renameTo);
        if (!result.ok) {
          setDialogError(result.error ?? "That didn't work. Try again.");
          return;
        }
        toast({ title: "Passkey renamed", tone: "success" });
      }
      closeDialog();
      router.refresh();
    } finally {
      setWorking(false);
    }
  };

  const lastPasskey = security.passkeys.length === 1;

  return (
    <>
      <Card className="account-card" data-testid="passkeys-panel">
        <h2>Passkeys</h2>
        {security.passkeys.length === 0 ? (
          <EmptyState
            title="No passkeys yet"
            description="Add one to sign in with your fingerprint or face — no code needed."
          />
        ) : (
          <ul className="security-list">
            {security.passkeys.map((passkey) => (
              <li key={passkey.id}>
                <span className="security-name">{passkey.name}</span>
                <span className="security-meta">
                  {passkey.lastUsedAt !== null
                    ? `last used ${formatDate(passkey.lastUsedAt)}`
                    : "never used"}
                </span>
                <span className="security-actions">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRenameTo(passkey.name);
                      setDialogError(null);
                      setPending({ kind: "rename-passkey", id: passkey.id, name: passkey.name });
                    }}
                  >
                    Rename
                    <VisuallyHidden> {passkey.name}</VisuallyHidden>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDialogError(null);
                      setPending({ kind: "remove-passkey", id: passkey.id, name: passkey.name });
                    }}
                  >
                    Remove
                    <VisuallyHidden> {passkey.name}</VisuallyHidden>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="enroll-row">
          <Field
            label="Device name"
            /* The old placeholder shipped a developer's own name to every user
               of the product. An instruction beats an example here anyway. */
            placeholder="e.g. My phone"
            required
            value={deviceName}
            onChange={(event) => {
              setDeviceName(event.target.value);
              setEnrollError(null);
            }}
            {...(enrollError !== null ? { error: enrollError } : {})}
          />
          <Button onClick={() => void enroll()} loading={busy} data-testid="enroll-passkey">
            Add passkey
          </Button>
        </div>
      </Card>

      <Card className="account-card" data-testid="sessions-panel">
        <h2>Active sessions</h2>
        <p className="security-intro">
          {security.sessions.length === 1
            ? "This is the only device signed into your account."
            : `${String(security.sessions.length)} devices are signed in. This device is first; the rest are ordered by when they were last used.`}
        </p>
        <ul className="security-list">
          {security.sessions.slice(0, sessionsShown).map((session) => (
            <li key={session.id} data-current={session.current}>
              <span className="security-name">
                {session.device ?? "Unknown device"}
                {session.current ? (
                  <>
                    {" "}
                    <Badge tone="info">This device</Badge>
                  </>
                ) : null}
              </span>
              <span className="security-meta" title={session.userAgent ?? undefined}>
                {/* `lastSeenAt` was fetched and thrown away. "Since March" tells
                    you nothing about whether a session is still in use; "last
                    active today" is the fact that decides a revoke. */}
                last active{" "}
                <time dateTime={session.lastSeenAt.toISOString()}>
                  {formatDate(session.lastSeenAt)}
                </time>{" "}
                · signed in {formatDate(session.createdAt)}
              </span>
              <span className="security-actions">
                {!session.current ? (
                  <Button
                    variant="danger"
                    onClick={() => {
                      setDialogError(null);
                      setPending({ kind: "revoke-session", session });
                    }}
                  >
                    Revoke
                    <VisuallyHidden>
                      {" "}
                      {session.device ?? "unknown device"}, last active{" "}
                      {formatDate(session.lastSeenAt)}
                    </VisuallyHidden>
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <div className="security-footer">
          {sessionsShown < security.sessions.length ? (
            <Button
              variant="secondary"
              data-testid="show-more-sessions"
              onClick={() => {
                setSessionsShown((shown) => shown + PAGE);
              }}
            >
              Show more ({String(security.sessions.length - sessionsShown)} left)
            </Button>
          ) : null}
          {others.length > 0 ? (
            <Button
              variant="danger"
              data-testid="revoke-other-sessions"
              onClick={() => {
                setDialogError(null);
                setPending({ kind: "revoke-others", count: others.length });
              }}
            >
              Sign out all other devices
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="account-card" data-testid="events-panel">
        <h2>Security activity</h2>
        <ul className="security-list events">
          {security.events.slice(0, eventsShown).map((event, index) => (
            <li key={`${event.action}-${event.at.toISOString()}-${String(index)}`}>
              <span className="security-name" data-raw={!isKnownEvent(event.action)}>
                {labelForEvent(event.action)}
              </span>
              <span className="security-meta">
                <time dateTime={event.at.toISOString()}>{formatDateTime(event.at)}</time>
              </span>
            </li>
          ))}
        </ul>
        <div className="security-footer">
          {eventsShown < security.events.length ? (
            <Button
              variant="secondary"
              data-testid="show-more-events"
              onClick={() => {
                setEventsShown((shown) => shown + PAGE);
              }}
            >
              Show more ({String(security.events.length - eventsShown)} left)
            </Button>
          ) : null}
          {/* Truncation is ADMITTED rather than performed silently. */}
          {security.eventsTotal > security.events.length ? (
            <p className="security-note" data-testid="events-truncated">
              Showing the {String(security.events.length)} most recent of{" "}
              {String(security.eventsTotal)} events. Need the full history?{" "}
              <a href="/support">Ask support</a>.
            </p>
          ) : null}
        </div>
      </Card>

      <Dialog
        open={pending !== null}
        onClose={closeDialog}
        title={
          pending === null
            ? ""
            : pending.kind === "revoke-session"
              ? "Sign out this device?"
              : pending.kind === "revoke-others"
                ? "Sign out all other devices?"
                : pending.kind === "remove-passkey"
                  ? "Remove this passkey?"
                  : "Rename passkey"
        }
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog} disabled={working}>
              Cancel
            </Button>
            <Button
              variant={pending?.kind === "rename-passkey" ? "primary" : "danger"}
              loading={working}
              data-testid="confirm-security-action"
              onClick={() => void confirm()}
            >
              {pending === null
                ? "Confirm"
                : pending.kind === "revoke-session"
                  ? "Sign out"
                  : pending.kind === "revoke-others"
                    ? `Sign out ${String(pending.count)} ${pending.count === 1 ? "device" : "devices"}`
                    : pending.kind === "remove-passkey"
                      ? "Remove passkey"
                      : "Save name"}
            </Button>
          </>
        }
      >
        {pending === null ? null : pending.kind === "revoke-session" ? (
          <p>
            {pending.session.device ?? "This device"}, last active{" "}
            {formatDate(pending.session.lastSeenAt)}, will be signed out immediately and will need a
            fresh code or passkey to get back in.
          </p>
        ) : pending.kind === "revoke-others" ? (
          <p>
            {pending.count === 1 ? "One other device" : `${String(pending.count)} other devices`}{" "}
            will be signed out immediately. You will stay signed in on this one.
          </p>
        ) : pending.kind === "remove-passkey" ? (
          <p>
            “{pending.name}” will stop working immediately.{" "}
            {lastPasskey
              ? "This is your only passkey — after this you can only sign in with a code by SMS."
              : "You can still sign in with your other passkeys or a code by SMS."}
          </p>
        ) : (
          <Field
            label="Device name"
            required
            value={renameTo}
            onChange={(event) => {
              setRenameTo(event.target.value);
              setDialogError(null);
            }}
          />
        )}
        {dialogError !== null ? (
          <p className="security-error" role="alert" data-testid="security-action-error">
            {dialogError}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
