"use client";

import { Badge, Button, Card, EmptyState, Field, useToast } from "@desiauction/ui";
import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  finishPasskeyEnrollmentAction,
  removePasskeyAction,
  renamePasskeyAction,
  revokeSessionAction,
  startPasskeyEnrollmentAction,
  type AccountSecurity,
} from "../../server/auth/actions";

export function SecurityPanels({ security }: { security: AccountSecurity }) {
  const router = useRouter();
  const toast = useToast();
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);

  const enroll = async () => {
    setBusy(true);
    try {
      const options = await startPasskeyEnrollmentAction();
      if (options === null) {
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
        toast({ title: "Passkey enrollment failed", tone: "danger" });
      }
    } catch {
      toast({ title: "Passkey enrollment cancelled", tone: "info" });
    } finally {
      setBusy(false);
    }
  };

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
                    ? `last used ${passkey.lastUsedAt.toLocaleDateString()}`
                    : "never used"}
                </span>
                <span className="security-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const name = prompt("Rename passkey", passkey.name);
                      if (name !== null && name.trim() !== "") {
                        void renamePasskeyAction(passkey.id, name).then(() => {
                          router.refresh();
                        });
                      }
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void removePasskeyAction(passkey.id).then(() => {
                        router.refresh();
                      });
                    }}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="enroll-row">
          <Field
            label="Device name"
            placeholder="Praveen's iPhone"
            value={deviceName}
            onChange={(event) => {
              setDeviceName(event.target.value);
            }}
          />
          <Button onClick={() => void enroll()} loading={busy} data-testid="enroll-passkey">
            Add passkey
          </Button>
        </div>
      </Card>

      <Card className="account-card" data-testid="sessions-panel">
        <h2>Active sessions</h2>
        <ul className="security-list">
          {security.sessions.map((session) => (
            <li key={session.id}>
              <span className="security-name">
                {session.userAgent?.slice(0, 48) ?? "Unknown device"}
              </span>
              <span className="security-meta">
                since {session.createdAt.toLocaleDateString()}
                {session.current ? <Badge tone="live"> This device</Badge> : null}
              </span>
              <span className="security-actions">
                {!session.current ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      void revokeSessionAction(session.id).then(() => {
                        router.refresh();
                      });
                    }}
                  >
                    Revoke
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="account-card" data-testid="events-panel">
        <h2>Security activity</h2>
        <ul className="security-list events">
          {security.events.map((event, index) => (
            <li key={index}>
              <span className="security-name">{event.action}</span>
              <span className="security-meta">{event.at.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
