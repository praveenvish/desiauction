"use client";

import { Button, Dialog, Field, Select } from "@desiauction/ui";
import {
  createContext,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { track } from "../../lib/telemetry";
import { submitProblemReportAction, type ProblemReportState } from "../../server/support/actions";
import { captureViewport, EXCLUDE_ATTRIBUTE, shrinkImageFile } from "./capture";
import styles from "./report-problem.module.css";

/**
 * REPORT A PROBLEM, FROM ANYWHERE (FR-1 Phase 1).
 *
 * One provider in the root layout; any surface opens the dialog through
 * `useReportProblem()`, and any plain link to `#report-a-problem` opens it too —
 * which is how the public footer, a list of `{label, href}` rendered by a
 * package component, reaches it without learning about React context.
 *
 * WHAT THE PAGE WAS is captured the moment the dialog is asked for — the URL
 * and a picture of the viewport — before the person types a word, because by
 * the time they have finished describing it the page may have moved on.
 *
 * MOUNTED ONLY WHILE OPEN. A closed <dialog> keeps its whole form in the DOM,
 * which made every `getByLabel` on a page ambiguous once before (see
 * FormDialog). A report dialog on every page would do that everywhere.
 */

export const REPORT_PROBLEM_HASH = "#report-a-problem";

interface ReportProblemContextValue {
  readonly open: () => void;
}

const ReportProblemContext = createContext<ReportProblemContextValue>({ open: () => undefined });

export function useReportProblem(): () => void {
  return useContext(ReportProblemContext).open;
}

interface Snapshot {
  readonly pageUrl: string;
  readonly pathname: string;
  readonly context: Record<string, string>;
}

function takeSnapshot(): Snapshot {
  const theme = document.documentElement.getAttribute("data-theme") ?? "";
  return {
    // The server strips the query string, fragment and token segments; the
    // pathname shown in the dialog is stripped the same way for display.
    pageUrl: window.location.href,
    pathname: window.location.pathname.replace(
      /\/(join|owner-join|demo|review)\/[^/]+/,
      "/$1/[redacted]",
    ),
    context: {
      viewport: `${String(window.innerWidth)}×${String(window.innerHeight)} @${String(window.devicePixelRatio)}x`,
      userAgent: navigator.userAgent,
      theme,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

export function ReportProblemProvider({
  children,
  defaultEmail,
  signedIn,
}: {
  children: ReactNode;
  defaultEmail: string | null;
  signedIn: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // The session key forces a fresh form (and a fresh action state) per opening,
  // so the previous report's "thanks" never greets the next one.
  const [session, setSession] = useState(0);

  const open = useCallback(() => {
    setSnapshot(takeSnapshot());
    setSession((value) => value + 1);
    track("support.report_opened");
  }, []);

  const close = useCallback(() => {
    setSnapshot(null);
  }, []);

  // Plain links to #report-a-problem open the dialog rather than navigate.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest("a[href]");
      if (anchor === null || anchor === undefined) {
        return;
      }
      const href = anchor.getAttribute("href") ?? "";
      if (href === REPORT_PROBLEM_HASH || href.endsWith(`/${REPORT_PROBLEM_HASH}`)) {
        event.preventDefault();
        open();
      }
    };
    document.addEventListener("click", onClick, true);
    // Arriving with the hash (a link from an email or another page) opens it
    // once, then the hash is removed so a reload does not reopen it.
    if (window.location.hash === REPORT_PROBLEM_HASH) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      // Deferred a tick: the URL is the external system here, and opening is
      // the response to having read it — not a render-time state cascade.
      queueMicrotask(open);
    }
    return () => {
      document.removeEventListener("click", onClick, true);
    };
  }, [open]);

  return (
    <ReportProblemContext.Provider value={{ open }}>
      {children}
      {snapshot !== null ? (
        <ReportProblemDialog
          key={session}
          snapshot={snapshot}
          defaultEmail={defaultEmail}
          signedIn={signedIn}
          onClose={close}
        />
      ) : null}
    </ReportProblemContext.Provider>
  );
}

type Shot =
  | { readonly state: "capturing" }
  | {
      readonly state: "ready";
      readonly blob: Blob;
      readonly url: string;
      readonly source: "page" | "file";
    }
  | { readonly state: "none"; readonly reason: "failed" | "removed" | "rejected" };

function ReportProblemDialog({
  snapshot,
  defaultEmail,
  signedIn,
  onClose,
}: {
  snapshot: Snapshot;
  defaultEmail: string | null;
  signedIn: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<ProblemReportState, FormData>(
    submitProblemReportAction,
    {},
  );
  const [shot, setShot] = useState<Shot>({ state: "capturing" });
  const urlRef = useRef<string | null>(null);

  const adopt = useCallback((blob: Blob, source: "page" | "file") => {
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
    }
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setShot({ state: "ready", blob, url, source });
  }, []);

  useEffect(() => {
    let settled = false;
    const settle = (blob: Blob | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (blob === null) {
        setShot({ state: "none", reason: "failed" });
      } else {
        adopt(blob, "page");
      }
    };
    // A short timer, not animation frames: the menu that opened this has to
    // finish closing or it is what the picture shows, and a browser pauses
    // animation frames entirely in a background tab — measured, it left the
    // dialog on "Taking a screenshot…" for as long as the tab stayed hidden.
    const start = window.setTimeout(() => {
      void captureViewport().then(settle);
    }, 120);
    // A capture that has not finished in twenty seconds is not going to be
    // worth waiting for. Offer the upload instead of a spinner that never ends.
    const giveUp = window.setTimeout(() => {
      settle(null);
    }, 20_000);
    return () => {
      settled = true;
      window.clearTimeout(start);
      window.clearTimeout(giveUp);
      if (urlRef.current !== null) {
        URL.revokeObjectURL(urlRef.current);
      }
    };
  }, [adopt]);

  const submit = (formData: FormData) => {
    if (shot.state === "ready") {
      formData.set("screenshot", shot.blob, "screenshot.jpg");
    }
    track("support.report_sent", { screenshot: shot.state === "ready" });
    formAction(formData);
  };

  const errorFor = (name: string): string | undefined =>
    state.field === name && state.error !== undefined ? state.error : undefined;

  if (state.success === true) {
    return (
      <div {...{ [EXCLUDE_ATTRIBUTE]: "" }}>
        <Dialog
          open
          onClose={onClose}
          title="Thanks — it's with the team"
          footer={
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          }
        >
          <p className={styles["lead"]} data-testid="report-problem-done">
            We read every report. If you left an email, we&apos;ll write back there once we know
            more.
          </p>
        </Dialog>
      </div>
    );
  }

  return (
    <div {...{ [EXCLUDE_ATTRIBUTE]: "" }}>
      <Dialog open onClose={onClose} title="Report a problem" size="wide">
        <form action={submit} className={styles["form"]} data-testid="report-problem-form">
          <input type="hidden" name="pageUrl" value={snapshot.pageUrl} />
          <input type="hidden" name="context" value={JSON.stringify(snapshot.context)} />

          {/* The honeypot — see the demo form for why it is shaped this way. */}
          <div className={styles["trap"]} aria-hidden="true">
            <label htmlFor="report-company-website">Company website</label>
            <input
              id="report-company-website"
              name="company_website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          <p className={styles["page"]}>
            On <span className={styles["pagePath"]}>{snapshot.pathname}</span>
          </p>

          <Select label="What kind of problem?" name="category" defaultValue="bug">
            <option value="bug">Something is broken</option>
            <option value="confusing">Something is confusing</option>
            <option value="idea">I have an idea</option>
            <option value="other">Something else</option>
          </Select>

          <div className={styles["noteField"]}>
            <label className={styles["noteLabel"]} htmlFor="report-description">
              What happened?
            </label>
            <textarea
              id="report-description"
              name="description"
              rows={5}
              required
              minLength={5}
              maxLength={4000}
              className={styles["note"]}
              placeholder="What you did, what you expected, and what happened instead."
              aria-invalid={errorFor("description") !== undefined || undefined}
              aria-describedby={
                errorFor("description") !== undefined ? "report-description-error" : undefined
              }
            />
            {errorFor("description") !== undefined ? (
              <p id="report-description-error" className={styles["fieldError"]} role="alert">
                {errorFor("description")}
              </p>
            ) : null}
          </div>

          <Field
            label="Email for a reply (optional)"
            name="replyEmail"
            type="email"
            autoComplete="email"
            maxLength={254}
            defaultValue={defaultEmail ?? ""}
            help={
              signedIn
                ? "We'll only use it to reply about this report."
                : "Leave it blank and we can't write back to you."
            }
            error={errorFor("replyEmail")}
          />

          <fieldset className={styles["shot"]}>
            <legend className={styles["noteLabel"]}>Screenshot</legend>
            <ShotPanel shot={shot} onAdopt={adopt} onRemove={setShot} />
            {errorFor("screenshot") !== undefined ? (
              <p className={styles["fieldError"]} role="alert">
                {errorFor("screenshot")}
              </p>
            ) : null}
          </fieldset>

          {state.error !== undefined && (state.field === "form" || state.field === undefined) ? (
            <p className={styles["fieldError"]} role="alert">
              {state.error}
            </p>
          ) : null}

          <div className={styles["actions"]}>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={shot.state === "capturing"}>
              {shot.state === "capturing" ? "Taking screenshot…" : "Send report"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function ShotPanel({
  shot,
  onAdopt,
  onRemove,
}: {
  shot: Shot;
  onAdopt: (blob: Blob, source: "page" | "file") => void;
  onRemove: (next: Shot) => void;
}) {
  if (shot.state === "capturing") {
    return (
      <p className={styles["hint"]} role="status">
        Taking a screenshot of this page…
      </p>
    );
  }

  if (shot.state === "ready") {
    return (
      <>
        <img
          src={shot.url}
          alt={
            shot.source === "page" ? "Screenshot of the page you were on" : "The image you attached"
          }
          className={styles["preview"]}
          data-testid="report-problem-preview"
        />
        <p className={styles["hint"]}>
          Check it before you send — it shows what was on your screen. Phone numbers and other
          private details we know about are blanked out.
        </p>
        <div className={styles["shotActions"]}>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onRemove({ state: "none", reason: "removed" });
            }}
          >
            Remove screenshot
          </Button>
        </div>
      </>
    );
  }

  const message =
    shot.reason === "failed"
      ? "We couldn't take a screenshot of this page. You can attach one instead."
      : shot.reason === "rejected"
        ? "That file didn't work — use a PNG, JPEG or WebP image."
        : "No screenshot will be sent. You can attach an image instead.";

  return (
    <>
      <p className={styles["hint"]} role="status">
        {message}
      </p>
      <label className={styles["attach"]}>
        <span>Attach an image (optional)</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file === undefined) {
              return;
            }
            void shrinkImageFile(file).then((blob) => {
              if (blob === null) {
                onRemove({ state: "none", reason: "rejected" });
              } else {
                onAdopt(blob, "file");
              }
            });
          }}
        />
      </label>
    </>
  );
}

/** A button that opens the dialog — for server pages, which cannot hold a hook. */
export function ReportProblemButton({ children }: { children: ReactNode }) {
  const open = useReportProblem();
  return (
    <Button type="button" variant="secondary" onClick={open} data-testid="report-problem-open">
      {children}
    </Button>
  );
}
