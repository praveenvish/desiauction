"use client";

import { Button, IconLock } from "@desiauction/ui";
import { startAuthentication } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { finishPasskeyLoginAction, startPasskeyLoginAction } from "../../server/auth/actions";

export function PasskeyLogin({ next }: { next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await startPasskeyLoginAction();
      const response = await startAuthentication({ optionsJSON: options });
      const result = await finishPasskeyLoginAction(response, next);
      if (result.ok) {
        router.push(result.target);
        return;
      }
      setError("That passkey wasn't recognised.");
    } catch {
      setError(null); // user cancelled the ceremony — not an error
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="passkey-login">
      <Button
        variant="secondary"
        // Matches the OTP CTA beside it: this is a touch-first surface, and the
        // two doors out of the gate should not be different heights.
        size="touch"
        onClick={() => void login()}
        loading={busy}
        data-testid="passkey-login"
      >
        <IconLock size={18} className="icon-lead" />
        Sign in with a passkey
      </Button>
      {error !== null ? <p className="passkey-error">{error}</p> : null}
    </div>
  );
}
