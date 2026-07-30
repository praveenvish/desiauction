import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { currentSession } from "../../server/auth/actions";
import { RETURNING_COOKIE } from "../../server/auth/sessions";
import { safeNext } from "../../server/auth/redirect";
import { LoginPanel } from "./login-form";
import "./login.css";

export const metadata = { title: "Sign in · DesiAuction" };

/**
 * The trust argument, in one place. It used to exist only inside the
 * desktop-only scene, under `aria-hidden="true"` — which meant the page's whole
 * case for itself reached neither a screen-reader user nor anybody on a phone,
 * i.e. most of the people this gate converts. The marks render twice, split by
 * width (`display:none` keeps exactly one of them in the accessibility tree),
 * and only the ornament around them stays decorative.
 */
const TRUST_MARKS = [
  "Server-verified bidding",
  "Append-only ledger",
  "One code — then your passkey",
];

/**
 * The entry checkpoint, rebuilt to the 2026-07-24 council blueprint (Phase A).
 * The shell keeps the public header here (an escape hatch at the gate) but
 * drops the full sitemap footer for a compact one — a 1019px sitemap under a
 * conversion form is a bigger surface than the form.
 *
 * The step is read from the URL (`?step=code&to=…`) rather than held only in
 * React state, so a refresh, an app-switch to read the SMS, or the Back button
 * all land somewhere sane. See LoginPanel for why that matters.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; step?: string; to?: string }>;
}) {
  const [session, params, cookieStore] = await Promise.all([
    currentSession(),
    searchParams,
    cookies(),
  ]);
  if (session !== null) {
    redirect("/home");
  }
  const next = params.next;
  // "Continue where you were headed" must only be promised where it is true.
  // `?next=https://evil.example` is correctly refused by safeNext (PX-11) and
  // lands on /home — the security held, but the sentence above the form was
  // still telling the visitor they were being taken somewhere else.
  const honoredNext = next !== undefined && safeNext(next) === next && next !== "/home";
  const initialStep = params.step === "code" && params.to !== undefined ? "code" : "phone";
  return (
    <main className="login" data-theme="floodlight">
      {/* The floodlit brand panel. The scenery is decorative; the marks are not,
          so only the ornament carries aria-hidden. */}
      <aside className="login-scene">
        <div className="login-scene-inner">
          <p className="login-scene-kicker" aria-hidden="true">
            Tournament auctions, taken seriously
          </p>
          <p className="login-scene-line" aria-hidden="true">
            Your auction
            <br />
            answers to your number.
          </p>
          <ul className="login-scene-marks" aria-label="What you are signing in to">
            {TRUST_MARKS.map((mark) => (
              <li key={mark}>{mark}</li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="login-side">
        <div className="login-panel">
          <LoginPanel
            {...(next !== undefined ? { next } : {})}
            initialStep={initialStep}
            initialPhone={params.to ?? ""}
            honoredNext={honoredNext}
            returning={cookieStore.get(RETURNING_COOKIE) !== undefined}
          />
        </div>
        {/* Below 960px the scene does not render at all, so the marks ride with
            the form instead of vanishing. */}
        <ul className="login-trust" aria-label="What you are signing in to">
          {TRUST_MARKS.map((mark) => (
            <li key={mark}>{mark}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
