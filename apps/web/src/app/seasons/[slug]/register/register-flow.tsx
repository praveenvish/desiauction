"use client";

import {
  isBattingStyle,
  isBowlingStyle,
  BATTING_STYLES,
  BOWLING_STYLES,
  REGISTRATION_ROLES,
  battingStyleLabel,
  bowlingStyleLabel,
} from "@desiauction/core";
import { Badge, Button, Card, Field, Select } from "@desiauction/ui";
import { useEffect, useState, useTransition } from "react";

import { formatPhone } from "../../../../lib/format-phone";
import { track } from "../../../../lib/telemetry";
import { updateProfileAction } from "../../../../server/auth/actions";
import { submitRegistrationAction } from "../../../../server/competition/actions";
import { SelfPhotoUploader } from "./self-photo-uploader";

const ROLE_LABEL: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  all_rounder: "All-rounder",
  wicket_keeper: "Wicket-keeper",
};

type Step = "profile" | "role" | "review";

const draftKey = (slug: string) => `da:reg-draft:${slug}`;

/**
 * The exact words beside the checkbox, in one place, because they are both
 * rendered here AND stored verbatim on the consent record.
 *
 * Storing the sentence rather than a version number is deliberate: this file
 * will be edited, and a record saying "agreed to publication v3" is worthless
 * once v3 is gone. What a person agreed to has to survive the copy changing.
 */
const PUBLICATION_CONSENT_LABEL =
  "I understand that my name, playing role and the other details above will be published on public pages anyone with the link can read, and that my mobile number will not.";

/**
 * DA-35: the draft persisted ONE of the four answers step 2 collects. Date of
 * birth and both playing styles were dropped on any refresh — and because the
 * review omits blank rows by design, the loss was presented as a completed
 * form. The draft is now the whole step.
 */
interface Draft {
  role: string;
  dob: string;
  batting: string;
  bowling: string;
}

function readDraft(slug: string): Draft | null {
  const saved = window.localStorage.getItem(draftKey(slug));
  if (saved === null || saved === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Partial<Draft>;
      return {
        role: typeof record.role === "string" ? record.role : "",
        dob: typeof record.dob === "string" ? record.dob : "",
        batting: typeof record.batting === "string" ? record.batting : "",
        bowling: typeof record.bowling === "string" ? record.bowling : "",
      };
    }
  } catch {
    // Drafts written before this shape were a bare role string.
  }
  return { role: saved, dob: "", batting: "", bowling: "" };
}

/**
 * Three steps, two truths: the name persists to people.name the moment step 1
 * completes (server truth — a browser restart resumes at step 2), and the role
 * choice autosaves device-locally until submission creates the registration
 * row. All validation is the server's; errors render verbatim.
 */
export function RegisterFlow({
  slug,
  competitionName,
  phone,
  initialName,
  source,
}: {
  slug: string;
  competitionName: string;
  phone: string;
  initialName: string;
  /** Share-attribution `?ref` from the landing URL; "" when direct. */
  source: string;
}) {
  const [name, setName] = useState(initialName);
  const [nameDone, setNameDone] = useState(initialName.trim() !== "");
  const [role, setRole] = useState("");
  // Optional player profile (parity §3.2). Not gated — a bare role still submits.
  const [dob, setDob] = useState("");
  const [batting, setBatting] = useState("");
  const [bowling, setBowling] = useState("");
  const [step, setStep] = useState<Step>(nameDone ? "role" : "profile");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Deliberately NOT part of the device-local draft: consent is an act at the
  // moment of submission, not a preference restored from localStorage on a
  // machine the person may not be sitting at.
  const [consented, setConsented] = useState(false);
  const [pending, startTransition] = useTransition();

  const [restored, setRestored] = useState(false);

  // Draft recovery: restore EVERY saved answer and resume at review after a
  // refresh or a browser restart. The review below now shows all four, so
  // landing there is a chance to check them, not a way to hide what was lost.
  useEffect(() => {
    const saved = readDraft(slug);
    if (saved !== null) {
      setRole(saved.role);
      setDob(saved.dob);
      setBatting(saved.batting);
      setBowling(saved.bowling);
      if (initialName.trim() !== "") {
        setStep("review");
        setRestored(true);
      }
    }
  }, [slug, initialName]);

  const saveDraft = (next: Partial<Draft>) => {
    const current = readDraft(slug) ?? { role, dob, batting, bowling };
    window.localStorage.setItem(draftKey(slug), JSON.stringify({ ...current, ...next }));
  };

  const saveName = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await updateProfileAction({}, formData);
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      const value = (formData.get("name") as string | null) ?? "";
      setName(value.trim().replace(/\s+/g, " "));
      setNameDone(true);
      track("profile.completed");
      setStep("role");
    });
  };

  const chooseRole = (value: string) => {
    setRole(value);
    // Autosave the draft the moment it changes.
    saveDraft({ role: value });
  };

  const submit = () => {
    setError(null);
    if (!consented) {
      setError(
        "Please tick the box above to confirm you understand what becomes public before you submit.",
      );
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("role", role);
      if (dob !== "") {
        formData.set("dateOfBirth", dob);
      }
      if (batting !== "") {
        formData.set("battingStyle", batting);
      }
      if (bowling !== "") {
        formData.set("bowlingStyle", bowling);
      }
      if (source !== "") {
        formData.set("source", source);
      }
      /*
       * The consent travels to the server, for two reasons.
       *
       * It has to be ENFORCED there: the check above is a client gate, and a
       * client gate is a courtesy. And it has to be RECORDED there, with the
       * wording actually shown, because "what did they agree to?" is a question
       * about a past moment and today's copy is not evidence of it.
       *
       * The label is sent verbatim rather than as a version number so the
       * record survives this file being edited — which it will be.
       */
      formData.set("publicationConsent", "true");
      formData.set("publicationConsentText", PUBLICATION_CONSENT_LABEL);
      const result = await submitRegistrationAction(slug, {}, formData);
      if (result.done === true) {
        window.localStorage.removeItem(draftKey(slug));
        setDone(true);
      } else {
        setError(result.error ?? "That didn't save. Try again.");
        // A duplicate means truth moved on another device — show the status.
        if (result.error?.includes("already registered") === true) {
          window.location.reload();
        }
      }
    });
  };

  if (done) {
    return (
      <Card>
        {/* DA-31: the page kept its scroll position on submit, so the
            confirmation landed above the fold and a player could not tell
            whether anything had happened. Focus moves here, which scrolls it
            into view and announces it to a screen reader in one act. */}
        <p
          data-testid="registration-submitted"
          ref={(node) => {
            node?.focus();
          }}
          tabIndex={-1}
          role="status"
        >
          You&apos;re in — status <Badge tone="info">submitted</Badge>. The organizer reviews every
          registration; your status updates on this page and on Home.
        </p>
      </Card>
    );
  }

  const steps: { key: Step; label: string }[] = [
    { key: "profile", label: "Your name" },
    { key: "role", label: "How you play" },
    { key: "review", label: "Review" },
  ];
  const stepIndex = steps.findIndex((entry) => entry.key === step);

  return (
    <Card data-testid="register-card">
      <p className="register-hint">
        Registering for <strong>{competitionName}</strong> as {formatPhone(phone)} — verified.
      </p>
      <ol className="register-progress" aria-label="Registration progress">
        {steps.map((entry, index) => (
          <li
            key={entry.key}
            className={`register-step ${index === stepIndex ? "register-step-current" : index < stepIndex ? "register-step-done" : ""}`}
            aria-current={index === stepIndex ? "step" : undefined}
          >
            <span className="register-step-number">{index + 1}</span>
            {entry.label}
          </li>
        ))}
      </ol>

      {step === "profile" ? (
        <form action={saveName} className="register-form" data-testid="register-step-profile">
          <Field
            label="Your name"
            name="name"
            required
            autoFocus
            autoComplete="name"
            defaultValue={name}
            placeholder="Rohan Kulkarni"
            help="Published on this season's public page and on a player page of your own once the organizer publishes the season."
            {...(error !== null ? { error } : {})}
          />
          <Button type="submit" loading={pending}>
            Continue
          </Button>
        </form>
      ) : null}

      {step === "role" ? (
        <div className="register-form" data-testid="register-step-role">
          <Select
            label="Playing role"
            name="role"
            required
            value={role}
            onChange={(event) => {
              chooseRole(event.target.value);
            }}
            help="Saved as you go — you can come back any time."
            {...(error !== null ? { error } : {})}
          >
            <option value="">Choose your role…</option>
            {REGISTRATION_ROLES.map((entry) => (
              <option key={entry} value={entry}>
                {ROLE_LABEL[entry] ?? entry}
              </option>
            ))}
          </Select>
          {/* TODO(founder): this field accepts a date of birth from a minor
              with no gate, no guardian step and no differential treatment, and
              the derived age is then published on a public player page and on
              the share card that goes into a WhatsApp group. Nothing in
              apps/web or packages/core mentions a guardian, a minor or parental
              consent — the concept does not exist in this product. Needs a
              founder decision with legal advice, not an engineering guess:
              whether anything at all may be published about an under-18
              registrant, under what consent mechanism, how a guardian is
              verified, whether age should be published for ANY registrant, and
              whether profiles expire after the tournament. Deliberately not
              decided here; the disclosure below is made honest for everyone in
              the meantime. */}
          <Field
            label="Date of birth (optional)"
            name="dateOfBirth"
            type="date"
            value={dob}
            onChange={(event) => {
              setDob(event.target.value);
              saveDraft({ dob: event.target.value });
            }}
            help="Your AGE is published on your public player card and on shared link previews — the date itself never is. Leave this blank and no age is shown."
          />
          <Select
            label="Batting style (optional)"
            name="battingStyle"
            value={batting}
            onChange={(event) => {
              setBatting(event.target.value);
              saveDraft({ batting: event.target.value });
            }}
          >
            <option value="">Not specified</option>
            {BATTING_STYLES.map((style) => (
              <option key={style} value={style}>
                {battingStyleLabel(style)}
              </option>
            ))}
          </Select>
          <Select
            label="Bowling style (optional)"
            name="bowlingStyle"
            value={bowling}
            onChange={(event) => {
              setBowling(event.target.value);
              saveDraft({ bowling: event.target.value });
            }}
          >
            <option value="">Not specified</option>
            {BOWLING_STYLES.map((style) => (
              <option key={style} value={style}>
                {bowlingStyleLabel(style)}
              </option>
            ))}
          </Select>
          <div className="register-actions">
            {!nameDone ? null : (
              <Button
                variant="ghost"
                onClick={() => {
                  setStep("profile");
                }}
              >
                Back
              </Button>
            )}
            <Button
              disabled={role === ""}
              data-testid="register-continue"
              onClick={() => {
                setError(null);
                setStep("review");
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="register-form" data-testid="register-step-review">
          {restored ? (
            <p className="register-hint" role="status" data-testid="draft-restored">
              We brought back the answers you had already given. Check them, or go Back to change
              anything.
            </p>
          ) : null}
          <dl className="register-review">
            <dt>Name</dt>
            <dd>{name}</dd>
            <dt>Mobile</dt>
            <dd>{formatPhone(phone)}</dd>
            <dt>Playing role</dt>
            <dd>{ROLE_LABEL[role] ?? role}</dd>
            {/* DA-21: step 2 collects date of birth and both styles, and the
                review showed none of them — you could not check what you were
                about to submit. Omitted rows stay omitted rather than printing
                "Not specified" three times for someone who skipped them. */}
            {dob !== "" ? (
              <>
                <dt>Date of birth</dt>
                <dd>{dob}</dd>
              </>
            ) : null}
            {isBattingStyle(batting) ? (
              <>
                <dt>Batting style</dt>
                <dd>{battingStyleLabel(batting)}</dd>
              </>
            ) : null}
            {isBowlingStyle(bowling) ? (
              <>
                <dt>Bowling style</dt>
                <dd>{bowlingStyleLabel(bowling)}</dd>
              </>
            ) : null}
          </dl>
          <div className="register-photo">
            <SelfPhotoUploader slug={slug} name={name} />
            {/* DA-35: the form asks a stranger for their face and their date of
                birth, and the only thing it said about either was that a photo
                "makes your player card stand out". Where the photo goes is not
                a detail — it goes on public pages. */}
            <p className="competitions-hint" data-testid="photo-privacy">
              A photo is optional. If you add one it becomes public: it appears on this
              season&apos;s public page, on the auction board and screen, and on link previews when
              the season is shared. You can remove it any time and it disappears from all of them.
            </p>
          </div>
          {/* This said "What the organizer of {name} RECEIVES: your name, your
              mobile number, your playing role and anything optional you filled
              in above." Receives. A reasonable person reads that as "this goes
              to the club" — and then nine of those fields are published on the
              open internet, of which exactly one, the photo, was disclosed as
              public. The paragraph above about the photo is what a real
              disclosure reads like ("Where the photo goes is not a detail — it
              goes on public pages"); this is the rest of the form held to that
              same standard. The split is the point: one line for what stays
              private, one for what does not. */}
          <div className="register-consent" data-testid="register-privacy">
            {/* h2, not h3: the only heading above this on the page is the h1,
                and the review step renders no h2 of its own — an h3 here skips
                a level and axe fails `heading-order`. */}
            <h2 className="register-consent-head">Before you submit: what becomes public</h2>
            <p className="register-consent-line">
              <strong>Your mobile number stays private.</strong> It goes to the organizer of{" "}
              {competitionName} so they can reach you about this season, and it is published on no
              page, ever — not on the season page, not on your player page, not on a shared link.
            </p>
            <p className="register-consent-line">
              <strong>Everything else here is published</strong> once the organizer publishes this
              season: your name, your registration number, your playing role, your age if you gave a
              date of birth, your batting and bowling styles if you gave them, your photo if you add
              one, and later which team signs you. Anyone with the link can read it — no account, no
              sign-in.
            </p>
            <p className="register-consent-line">
              It appears in two places: this season&apos;s public player list, and a page of your
              own at a web address you can share. Both produce a preview card carrying your name and
              role when the link is pasted into WhatsApp or posted anywhere else. Player pages are
              marked not to be indexed by search engines, so they do not turn up in web searches.
            </p>
            <p className="register-consent-line">
              You can withdraw your registration from this page at any time, which takes both pages
              down. Full detail:{" "}
              <a href="/legal/privacy" target="_blank" rel="noreferrer">
                Privacy policy
              </a>{" "}
              ·{" "}
              <a href="/help/whats-public" target="_blank" rel="noreferrer">
                What&apos;s public about you
              </a>
              .
            </p>
          </div>
          {/* An affirmative act, adjacent to Submit — not a paragraph above the
              fold-break that a thumb scrolls past. Submit stays ENABLED and
              refuses out loud: a greyed-out button with no spoken reason is the
              same silence this whole block exists to end. */}
          <label className="register-consent-check" htmlFor="register-consent-box">
            <input
              id="register-consent-box"
              type="checkbox"
              checked={consented}
              data-testid="register-consent"
              onChange={(event) => {
                setConsented(event.target.checked);
                if (event.target.checked) {
                  setError(null);
                }
              }}
            />
            <span>{PUBLICATION_CONSENT_LABEL}</span>
          </label>
          {error !== null ? (
            <p role="alert" className="register-error">
              {error}
            </p>
          ) : null}
          <div className="register-actions">
            <Button
              variant="ghost"
              onClick={() => {
                setStep("role");
              }}
            >
              Back
            </Button>
            <Button loading={pending} data-testid="register-submit" onClick={submit}>
              Submit registration
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
