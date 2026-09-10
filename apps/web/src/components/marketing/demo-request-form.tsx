"use client";

import { Button, Field, Select } from "@desiauction/ui";
import Link from "next/link";
import { useActionState } from "react";

import { DEMAND_SPORTS } from "../../content/demand-sports";
import { requestDemoAction } from "../../server/marketing/actions";
import { track } from "../../lib/telemetry";
import { IconCalendar, IconCheck } from "./icons";
import styles from "./demo-request-form.module.css";

/**
 * THE FORM THAT REPLACED A MAILTO LINK.
 *
 * Field order is the order a person can answer in: who you are, how to reach
 * you, what you run, when it is. The optional things come last and say they are
 * optional, because a form that looks long is a form that does not get filled.
 *
 * It is a real `<form>` posting a server action, so it works with JavaScript
 * off — the whole page is public and the request is worth more than the
 * enhancement.
 *
 * Errors ride the `Field` primitive rather than a banner of our own: `Field`
 * puts the message in `aria-describedby` AND a `role="alert"`, keeps native
 * `required` on the control, and moves focus to the first failing field after a
 * rejected submit. A hand-rolled error paragraph here would have none of that.
 */
export function DemoRequestForm({ source }: { source: string }) {
  const [state, formAction, pending] = useActionState(requestDemoAction, {});

  if (state.success === true) {
    return (
      <div className={styles["done"]} data-testid="demo-request-done">
        <p className={styles["doneHead"]}>
          <IconCheck width={20} height={20} aria-hidden />
          Got it — we have your request.
        </p>
        <p className={styles["doneBody"]}>
          We&apos;ll come back to you within one working day to fix a time. The demo runs on a
          tournament we&apos;ve already finished, so you see the squads, the bidding and the money
          afterwards rather than an empty screen.
        </p>
        {state.requestId !== undefined ? (
          <p className={styles["doneBody"]}>
            <Link href={`/schedule-demo/pick?r=${state.requestId}`} className={styles["pickLink"]}>
              <IconCalendar width={16} height={16} aria-hidden />
              Or pick a time yourself
            </Link>
          </p>
        ) : null}
        <p className={styles["doneBody"]}>
          Not waiting?{" "}
          <Link href="/login" className={styles["pickLink"]}>
            Start your auction now
          </Link>{" "}
          — every tournament gets the full platform, free, during beta.
        </p>
      </div>
    );
  }

  const errorFor = (name: string): string | undefined =>
    state.field === name && state.error !== undefined ? state.error : undefined;

  return (
    <form
      action={formAction}
      className={styles["form"]}
      onSubmit={() => {
        track("demo.requested", { source });
      }}
    >
      <input type="hidden" name="source" value={source} />

      {/* The honeypot. Hidden from sight and from assistive technology, never
          autofilled, and never seen by a person — so anything in it came from
          something that reads the DOM rather than the page. */}
      <div className={styles["trap"]} aria-hidden="true">
        <label htmlFor="company_website">Company website</label>
        <input
          id="company_website"
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className={styles["row"]}>
        <Field
          label="Your name"
          name="name"
          autoComplete="name"
          required
          maxLength={120}
          error={errorFor("name")}
        />
        <Field
          label="Mobile number"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          required
          placeholder="98765 43210"
          help="We'll call or WhatsApp this number."
          error={errorFor("phone")}
        />
      </div>

      <Field
        label="Tournament or club"
        name="orgName"
        required
        maxLength={120}
        placeholder="Sunday Warriors Premier League"
        error={errorFor("orgName")}
      />

      {/*
        No `defaultValue`. Every other select here opens on a sensible answer,
        because a form that arrives half-filled gets finished. This one must
        not: it is the only question on the page whose answers get COUNTED, and
        a preselected "Cricket" would be indistinguishable from thousands of
        people choosing it. The empty option makes the browser ask.
      */}
      <Select label="Which sport?" name="sport" required defaultValue="">
        <option value="" disabled>
          Choose a sport
        </option>
        {/*
          RENDERED FROM THE LIST, not retyped beside it. The server refuses a
          sport it does not recognise rather than folding it to "other" —
          deliberately, because this is the one answer on the page that gets
          counted — so an option whose value has drifted is not a cosmetic
          mismatch, it is a form that cannot be submitted. Two had drifted, and
          neither was visible to the type system: `table_tennis` was renamed in
          0057 everywhere but here, so choosing Table tennis had been refused
          ever since; `box_cricket` was a valid answer nobody could give.
        */}
        {DEMAND_SPORTS.map((sport) => (
          <option key={sport.key} value={sport.key}>
            {sport.label}
          </option>
        ))}
      </Select>

      <div className={styles["row"]}>
        <Select label="How many teams?" name="tournamentSize" required defaultValue="8-16">
          <option value="under-8">Under 8</option>
          <option value="8-16">8 to 16</option>
          <option value="16-32">16 to 32</option>
          <option value="over-32">More than 32</option>
          <option value="unsure">Not sure yet</option>
        </Select>
        <Select label="Best time to talk" name="preferredWindow" required defaultValue="any">
          <option value="any">Any time</option>
          <option value="weekday-evening">Weekday evenings</option>
          <option value="weekend-morning">Weekend mornings</option>
          <option value="weekend-evening">Weekend evenings</option>
        </Select>
      </div>

      <div className={styles["row"]}>
        <Field
          label="When's your auction?"
          name="auctionOn"
          type="date"
          help="Leave blank if the date isn't fixed."
          error={errorFor("auctionOn")}
        />
        <Field
          label="Email (optional)"
          name="email"
          type="email"
          autoComplete="email"
          help="For a written confirmation."
          error={errorFor("email")}
        />
      </div>

      <div className={styles["noteField"]}>
        {/* Same optional convention as the Email field above — one form, one
            way of saying it. */}
        <label className={styles["noteLabel"]} htmlFor="demo-note">
          Anything else? <span className={styles["optional"]}>(optional)</span>
        </label>
        <textarea
          id="demo-note"
          name="note"
          rows={3}
          maxLength={2000}
          className={styles["note"]}
          placeholder="What you're worried about, what you tried last year, who else needs to see it. If you picked another sport, tell us which."
        />
      </div>

      {/* A form-level failure has no field to attach to, so it gets its own
          alert. Field-level ones never land here — they ride the control. */}
      {state.error !== undefined && (state.field === "form" || state.field === undefined) ? (
        <p className={styles["formError"]} role="alert">
          {state.error}
        </p>
      ) : null}

      <div className={styles["actions"]}>
        <Button type="submit" size="lg" loading={pending}>
          Book a demo
        </Button>
        <p className={styles["assurance"]}>
          One working day, usually less. We use your number to arrange the demo and nothing else.
        </p>
      </div>
    </form>
  );
}
