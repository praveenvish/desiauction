"use client";

import { Button } from "@desiauction/ui";
import { startAuthentication } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { finishPasskeyLoginAction, startPasskeyLoginAction } from "../../server/auth/actions";

export function PasskeyLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await startPasskeyLoginAction();
      const response = await startAuthentication({ optionsJSON: options });
      const result = await finishPasskeyLoginAction(response);
      if (result.ok) {
        router.push("/home");
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
        onClick={() => void login()}
        loading={busy}
        data-testid="passkey-login"
      >
        Sign in with a passkey
      </Button>
      {error !== null ? <p className="passkey-error">{error}</p> : null}
    </div>
  );
}
