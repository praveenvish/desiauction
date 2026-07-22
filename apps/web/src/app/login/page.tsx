import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { LoginForm } from "./login-form";
import { PasskeyLogin } from "./passkey-login";
import "./login.css";

export const metadata = { title: "Sign in · DesiAuction" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [session, params] = await Promise.all([currentSession(), searchParams]);
  if (session !== null) {
    redirect("/home");
  }
  return (
    // One continuous floodlit surface — the scene and the form share a theme
    // so the primary CTA carries the brand's lime accent, not daylight olive.
    <main className="login" data-theme="floodlight">
      {/* The floodlit brand panel: desktop-only scenery (aria-hidden — the
          form panel carries every accessible word). */}
      <aside className="login-scene" aria-hidden="true">
        <div className="login-scene-inner">
          <p className="login-scene-kicker">Tournament auctions, taken seriously</p>
          <p className="login-scene-line">
            The auction night
            <br />
            your tournament deserves.
          </p>
          <ul className="login-scene-marks">
            <li>Server-verified bidding</li>
            <li>Immutable ledger</li>
            <li>Phone-first sign-in</li>
          </ul>
        </div>
      </aside>
      <div className="login-side">
        <div className="login-panel">
          <p className="login-eyebrow">DesiAuction</p>
          <h1>Sign in</h1>
          <p className="login-sub">
            {params.next !== undefined
              ? "Sign in to continue where you were headed."
              : "Sign in with your mobile number — we'll text you a one-time code."}
          </p>
          <LoginForm {...(params.next !== undefined ? { next: params.next } : {})} />
          <div className="login-divider" aria-hidden="true">
            <span>or</span>
          </div>
          <PasskeyLogin />
        </div>
      </div>
    </main>
  );
}
