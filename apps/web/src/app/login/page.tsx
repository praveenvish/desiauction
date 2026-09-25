import { SPORTS } from "@desiauction/core";
import { IconBolt, IconLedger, IconShieldCheck } from "@desiauction/ui";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "../../env";
import { currentSession } from "../../server/auth/actions";
import { RETURNING_COOKIE } from "../../server/auth/sessions";
import { safeNext } from "../../server/auth/redirect";
import { ScriptTag, SportMontage } from "../../components/public/public-kit";
import { LoginPanel } from "./login-form";
import type { ReactNode } from "react";

import type { LoginMethod } from "./login-shared";
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

/** The same three marks, with the sentence that makes each one mean something. */
const TRUST_DETAIL: { mark: string; detail: string; icon: ReactNode }[] = [
  {
    mark: "Server-verified bidding",
    detail: "Every bid is decided by the server, not by a browser.",
    icon: <IconShieldCheck width={20} height={20} />,
  },
  {
    mark: "Append-only ledger",
    detail: "Nothing is edited after the fact. Corrections are added, not overwritten.",
    icon: <IconLedger width={20} height={20} />,
  },
  {
    mark: "One code — then your passkey",
    detail: "Sign in with a code, then add a passkey to this device.",
    icon: <IconBolt width={20} height={20} />,
  },
];

/**
 * WHAT THE FACTS ROW MAY SAY (founder, 2026-09-19).
 *
 * The mockup carried "10K+ players · 500+ tournaments · 100+ organizations".
 * We have none of those numbers and the content ruling of 2026-07-24 forbids
 * inventing them. These four are true today, and the first counts itself from
 * the sport packs, so it cannot rot when a sport is added.
 */
const GATE_FACTS = [
  `${String(SPORTS.length)} sports`,
  "Free during beta",
  "Watch live, no account",
  "Server-verified bids",
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
  searchParams: Promise<{ next?: string; step?: string; to?: string; method?: string }>;
}) {
  const [session, params, cookieStore] = await Promise.all([
    currentSession(),
    searchParams,
    cookies(),
  ]);
  const next = params.next;
  if (session !== null) {
    // Already signed in: go where the link was going, not to a generic /home.
    redirect(safeNext(next));
  }
  // "Continue where you were headed" must only be promised where it is true.
  // `?next=https://evil.example` is correctly refused by safeNext (PX-11) and
  // lands on /home — the security held, but the sentence above the form was
  // still telling the visitor they were being taken somewhere else.
  const honoredNext = next !== undefined && safeNext(next) === next && next !== "/home";
  const initialStep = params.step === "code" && params.to !== undefined ? "code" : "start";
  // Which door. An explicit `?method=` wins; a code-step link that predates it
  // (`?step=code&to=+91…`) is recognisably a phone one; everything else opens
  // on LOGIN_DEFAULT_METHOD — email until SMS is live.
  const method: LoginMethod =
    params.method === "email" || params.method === "phone"
      ? params.method
      : initialStep === "code" && params.to?.startsWith("+") === true
        ? "phone"
        : env.LOGIN_DEFAULT_METHOD;
  return (
    <main className="login" data-theme="floodlight">
      {/* The floodlit brand panel. The scenery is decorative; the marks are not,
          so only the ornament carries aria-hidden. */}
      <aside className="login-scene">
        <div className="login-scene-inner">
          <p className="login-scene-kicker" aria-hidden="true">
            Auctions for every sport
          </p>
          <p className="login-scene-line" aria-hidden="true">
            Your auction
            <br />
            answers to your number.
          </p>
          {/* The marks, each with the sentence that makes it mean something.
              The list is real content (it is the page's whole argument), so it
              is NOT aria-hidden — only the scenery around it is. */}
          <ul className="login-scene-marks" aria-label="What you are signing in to">
            {TRUST_DETAIL.map((entry) => (
              <li key={entry.mark}>
                <span className="login-mark-icon" aria-hidden="true">
                  {entry.icon}
                </span>
                <span>
                  <b>{entry.mark}</b>
                  <span className="login-mark-detail">{entry.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="login-scene-art" aria-hidden="true">
            <SportMontage />
            <ScriptTag>
              Play
              <br />
              Bid
              <br />
              Belong
            </ScriptTag>
          </div>
          <ul className="login-facts" aria-label="About DesiAuction">
            {GATE_FACTS.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="login-side">
        <div className="login-panel">
          <LoginPanel
            {...(next !== undefined ? { next } : {})}
            method={method}
            initialStep={initialStep}
            initialTo={params.to ?? ""}
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
