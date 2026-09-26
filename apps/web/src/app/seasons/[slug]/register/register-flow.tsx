"use client";

import { isMinor, type AttributeOption } from "@desiauction/core";
import { Button, Card, Field, IconCheck, IconEye, PlayerImage, Select } from "@desiauction/ui";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { formatDate } from "../../../../lib/format-date";
import { formatPhone } from "../../../../lib/format-phone";
import { useHydrated } from "../../../../lib/use-hydrated";
import {
  WHATSAPP_CONSENT_LABEL,
  WHATSAPP_LANGUAGE_LABELS,
  WHATSAPP_LANGUAGES,
  type WhatsAppLanguage,
} from "../../../../lib/whatsapp-consent";
import { track } from "../../../../lib/telemetry";
import { updateProfileAction } from "../../../../server/auth/actions";
import { submitRegistrationAction } from "../../../../server/competition/actions";
import { AddPhoneStep } from "./add-phone-step";
import { RegStepper } from "./reg-stepper";
import { RegistrationStatus } from "./registration-status";
import { SelfPhotoUploader } from "./self-photo-uploader";

/**
 * The steps that can exist. Only the ones that APPLY are shown and numbered:
 * `mobile` for an email account with no number, `you` for a nameless account.
 * Somebody who already has both starts at "How you play" as step 1 of 2.
 */
type Step = "mobile" | "you" | "play" | "confirm";

const STEP_LABEL: Record<Step, string> = {
  mobile: "Mobile",
  you: "You",
  play: "How you play",
  confirm: "Confirm",
};

const STEP_TITLE: Record<Step, string> = {
  mobile: "Add your mobile number",
  you: "About you",
  play: "How you play",
  confirm: "Check and confirm",
};

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
  "I understand my name, role and the details above will be published on public pages anyone with the link can read — and my mobile number will not.";

/**
 * PRR P0-2 (DPDP Act 2023 §9): the guardian consent shown when the date of birth
 * entered is under 18. Stored verbatim on the consent record, like the label
 * above, so the wording a guardian agreed to survives this copy being edited.
 */
const GUARDIAN_CONSENT_LABEL =
  "I am the parent or legal guardian of this player, who is under 18, and I consent to this registration and to their details being processed for this tournament. Their age and photo are never shown on public pages.";

/**
 * Said where the fields are, so it never has to describe where they are. The
 * old wording pointed "below" from a screen that did not carry them.
 */
const GUARDIAN_REQUIRED =
  "This player is under 18. Add a parent or guardian's name and tick their consent to continue.";

/**
 * DA-35: the draft persisted ONE of the four answers step 2 collects. Date of
 * birth and both playing styles were dropped on any refresh — and because the
 * review omits blank rows by design, the loss was presented as a completed
 * form. The draft is now the whole step.
 */
interface Draft {
  role: string;
  dob: string;
  /** Keyed by the SEASON'S pack attribute keys — see the note on the props. */
  attributes: Record<string, string>;
}

/**
 * Two older shapes still live in people's browsers and both are read back.
 *
 * A draft is device-local and can be weeks old: the very first version stored a
 * bare role string, and the version after it stored `{ role, dob, batting,
 * bowling }` — cricket's two styles as named fields, because at the time there
 * was no other sport. Those two keys are lifted into the attribute map under
 * the keys cricket's pack actually declares, so somebody who started a cricket
 * registration before this change and finishes it after does not silently lose
 * both answers on the step that shows them nothing missing.
 */
function readDraft(slug: string): Draft | null {
  let saved: string | null;
  try {
    saved = window.localStorage.getItem(draftKey(slug));
  } catch {
    // Storage blocked (private mode, site data disabled): there is no draft.
    return null;
  }
  if (saved === null || saved === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed === "object" && parsed !== null) {
      // Everything here is `unknown` deliberately: this is JSON from a browser
      // store, which may hold any of three historical shapes and may have been
      // edited by hand. Nothing is trusted until it has been checked.
      const record = parsed as {
        role?: unknown;
        dob?: unknown;
        attributes?: unknown;
        batting?: unknown;
        bowling?: unknown;
      };
      const attributes: Record<string, string> = {};
      if (typeof record.attributes === "object" && record.attributes !== null) {
        for (const [key, value] of Object.entries(record.attributes)) {
          if (typeof value === "string") {
            attributes[key] = value;
          }
        }
      }
      if (typeof record.batting === "string" && record.batting !== "") {
        attributes["batting_style"] ??= record.batting;
      }
      if (typeof record.bowling === "string" && record.bowling !== "") {
        attributes["bowling_style"] ??= record.bowling;
      }
      return {
        role: typeof record.role === "string" ? record.role : "",
        dob: typeof record.dob === "string" ? record.dob : "",
        attributes,
      };
    }
  } catch {
    // Drafts written before this shape were a bare role string.
  }
  return { role: saved, dob: "", attributes: {} };
}

/** The step the device-local draft should resume at, if any. */
function resumeStep(draft: Draft): Step {
  // Straight to Confirm only when there is a role to confirm; a draft holding
  // just a birth date resumes where the role is chosen.
  return draft.role === "" ? "play" : "confirm";
}

/**
 * Up to four steps, two truths: the name persists to people.name the moment
 * "You" completes (server truth — a browser restart resumes past it), and the
 * "How you play" answers autosave device-locally until submission creates the
 * registration row. All validation is the server's; errors render verbatim.
 */
export function RegisterFlow({
  slug,
  competitionName,
  listed,
  phone,
  initialName,
  initialPhotoUrl,
  source,
  roles,
  attributes,
  profileDefaults,
  initialLanguage = "en",
  verifiedLead = false,
}: {
  /**
   * Lead the progress row with a ticked "Verified" — the step a signed-out
   * visitor completed inline on this page before the rest of the wizard.
   */
  verifiedLead?: boolean;
  slug: string;
  competitionName: string;
  /** The season is published — the confirmation links its public page. */
  listed: boolean;
  /**
   * The verified number, or null for an account anchored by email alone (0062).
   * Null puts a "Mobile" step first; a player is reached by text, so a season
   * entry needs one and the server refuses a registration without it.
   */
  phone: string | null;
  initialName: string;
  /** The person's own photo (consented), or null — the initials mark stands in. */
  initialPhotoUrl: string | null;
  /** Share-attribution `?ref` from the landing URL; "" when direct. */
  source: string;
  /**
   * THE SEASON'S OWN ROLES, as plain {key,label} pairs.
   *
   * This control was built from `REGISTRATION_ROLES` — an alias for CRICKET's
   * four — so the registration form for a football season offered Batter,
   * Bowler, All-rounder and Wicket-keeper, and a footballer had no role to
   * pick. Plain strings rather than the pack itself: a pack carries functions
   * (a tiebreaker's `compute`) and cannot cross into a client component.
   */
  roles: readonly { key: string; label: string }[];
  /**
   * THE SEASON'S OWN OPTIONAL PLAYER DETAIL, as plain {key,label,options} data.
   *
   * This form once asked every registrant for cricket's batting and bowling
   * style whatever the season's sport was. Cricket is unchanged by the fix: its
   * pack declares the same two attributes with the same labels and options,
   * and records that they live in their own columns.
   */
  attributes: readonly AttributeOption[];
  /**
   * The person's one language for messages as it stands (/account's "Language
   * for messages"), so ticking WhatsApp here starts from their choice rather
   * than quietly putting a Hindi reader back on English at submit.
   */
  initialLanguage?: WhatsAppLanguage;
  /** PI-1: the person-level profile for THIS sport, prefilling "How you play".
   *  A device-local draft still wins over it — the draft is this season's
   *  newer intent. */
  profileDefaults: { role: string; dob: string; attributes: Record<string, string> } | null;
}) {
  // Which steps apply is decided once, from what the account held on arrival:
  // finishing "Mobile" or "You" must tick that step off, not delete it from the
  // progress bar and renumber everything under the person's thumb.
  const [askPhone] = useState(phone === null);
  const [askName] = useState(initialName.trim() === "");
  const [name, setName] = useState(initialName);
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [role, setRole] = useState(profileDefaults?.role ?? "");
  // Optional player profile (parity §3.2). Not gated — a bare role still submits.
  const [dob, setDob] = useState(profileDefaults?.dob ?? "");
  const [attrs, setAttrs] = useState<Record<string, string>>(profileDefaults?.attributes ?? {});
  // PI-1 write-back: on by default, an act of the submit, never of the draft.
  const [remember, setRemember] = useState(true);
  // PRR P0-2: guardian consent, required only when the entered DOB is under 18.
  const [guardianName, setGuardianName] = useState("");
  const [guardianConsent, setGuardianConsent] = useState(false);
  /** Kept apart from `error`: a guardian message belongs beside the guardian fields. */
  const [guardianError, setGuardianError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(askName ? "you" : "play");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Deliberately NOT part of the device-local draft: consent is an act at the
  // moment of submission, not a preference restored from localStorage on a
  // machine the person may not be sitting at.
  const [consented, setConsented] = useState(false);
  // WhatsApp opt-in: unticked, and like consent never restored from a draft —
  // Meta and DPDP both need it to be a choice made now (Phase 3).
  const [whatsapp, setWhatsapp] = useState(false);
  // Which language their messages come in — asked once they tick the box, and
  // saved as their ONE language (email follows it too) when they submit.
  const [whatsappLanguage, setWhatsappLanguage] = useState<WhatsAppLanguage>(initialLanguage);
  const [pending, startTransition] = useTransition();
  const [restored, setRestored] = useState(false);

  // The number is server truth: it arrives through a page refresh once the
  // "Mobile" step verifies it, and every other step waits behind it.
  const current: Step = phone === null ? "mobile" : step;

  /*
   * FOCUS FOLLOWS THE STEP. Each step swaps the whole panel, which left focus
   * on a button that no longer existed — a screen reader heard nothing, and a
   * keyboard user restarted from the top of the document. Moving to the new
   * step's heading announces where they are and scrolls it into view. Only
   * after a move: on arrival the name field keeps its autofocus.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Where Continue sends focus when it refuses — the refusal is often below
  // the fold on a phone, and an error nobody can see is no error at all.
  const firstRoleRef = useRef<HTMLInputElement>(null);
  const guardianRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);
  const goTo = (next: Step) => {
    moved.current = true;
    setStep(next);
  };
  useEffect(() => {
    if (moved.current) {
      moved.current = false;
      headingRef.current?.focus();
    }
  }, [current]);

  // Draft recovery: restore EVERY saved answer and resume at Confirm after a
  // refresh or a browser restart, where all of them are shown to be checked.
  //
  // Read once per season, in the first render after hydration (the server has
  // no localStorage, so an earlier read would mismatch the markup it sent).
  // Adjusting state during that render replaces an effect that committed the
  // empty form first and then re-rendered it filled.
  const hydrated = useHydrated();
  const [draftReadFor, setDraftReadFor] = useState<string | null>(null);
  if (hydrated && draftReadFor !== slug) {
    setDraftReadFor(slug);
    const saved = readDraft(slug);
    if (saved !== null) {
      setRole(saved.role);
      setDob(saved.dob);
      setAttrs(saved.attributes);
      if (!askName) {
        setStep(resumeStep(saved));
        setRestored(resumeStep(saved) === "confirm");
      }
    }
  }

  const saveDraft = (next: Partial<Draft>) => {
    const currentDraft = readDraft(slug) ?? { role, dob, attributes: attrs };
    try {
      window.localStorage.setItem(draftKey(slug), JSON.stringify({ ...currentDraft, ...next }));
    } catch {
      // Storage blocked: the answers live in this tab only. Nothing to tell.
    }
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
      track("profile.completed");
      goTo("play");
    });
  };

  const chooseRole = (value: string) => {
    setRole(value);
    setRoleError(null);
    // Autosave the draft the moment it changes.
    saveDraft({ role: value });
  };

  // PRR P0-2: whether the entered date of birth makes this registrant a minor.
  // `dob` is "" until the user types one (the draft loads client-side after
  // mount), so this is false during SSR and cannot cause a hydration mismatch.
  const dobIsMinor = dob !== "" && isMinor(dob, new Date());
  const guardianMissing = dobIsMinor && (guardianName.trim() === "" || !guardianConsent);
  const roleLabel = roles.find((entry) => entry.key === role)?.label ?? role;

  const submit = () => {
    setError(null);
    if (!consented) {
      setError(
        "Please tick the box above to confirm you understand what becomes public before you submit.",
      );
      return;
    }
    if (guardianMissing) {
      // The guardian fields live on "How you play" — send them there and mark
      // the fields, rather than describing a box they cannot see from here.
      setGuardianError(GUARDIAN_REQUIRED);
      goTo("play");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("role", role);
      if (dob !== "") {
        formData.set("dateOfBirth", dob);
      }
      if (dobIsMinor) {
        formData.set("guardianName", guardianName.trim());
        formData.set("guardianConsent", "true");
        formData.set("guardianConsentText", GUARDIAN_CONSENT_LABEL);
      }
      /*
       * One namespaced field per attribute the SEASON'S pack declares, and
       * nothing else. A value left over in a draft for an attribute this sport
       * does not have is simply never sent; the server re-validates every key
       * and value against the same pack regardless.
       */
      for (const attribute of attributes) {
        const value = attrs[attribute.key] ?? "";
        if (value !== "") {
          formData.set(`attr.${attribute.key}`, value);
        }
      }
      if (source !== "") {
        formData.set("source", source);
      }
      /*
       * The consent travels to the server, to be ENFORCED there (a client gate
       * is a courtesy) and RECORDED there with the wording actually shown —
       * verbatim rather than a version number, so the record survives this
       * file being edited.
       */
      formData.set("publicationConsent", "true");
      formData.set("publicationConsentText", PUBLICATION_CONSENT_LABEL);
      // PI-1: "remember for next time" — the server writes these answers back
      // to the person-level profile so the NEXT season starts filled in.
      formData.set("rememberProfile", remember ? "true" : "false");
      if (whatsapp) {
        formData.set("whatsappOptIn", "true");
        formData.set("whatsappConsentText", WHATSAPP_CONSENT_LABEL);
        formData.set("whatsappLanguage", whatsappLanguage);
      }
      const result = await submitRegistrationAction(slug, {}, formData);
      if (result.done === true) {
        try {
          window.localStorage.removeItem(draftKey(slug));
        } catch {
          // Storage blocked: there was no draft to clear.
        }
        setDone(true);
      } else {
        setError(result.error ?? "That didn't save. Try again.");
        // A duplicate means truth moved on another device — show the status.
        if (result.code === "already_registered") {
          window.location.reload();
        }
      }
    });
  };

  if (done) {
    return (
      <RegistrationStatus
        justSubmitted
        competitionName={competitionName}
        slug={slug}
        listed={listed}
        status="submitted"
        number={null}
        name={name}
        photoUrl={photoUrl}
        roleLabel={roleLabel}
        rejectionReason={null}
      />
    );
  }

  const steps: Step[] = [
    ...(askPhone ? (["mobile"] as const) : []),
    ...(askName ? (["you"] as const) : []),
    "play",
    "confirm",
  ];
  const stepIndex = steps.indexOf(current);
  const returnTo = `/seasons/${slug}/register${source === "" ? "" : `?ref=${encodeURIComponent(source)}`}`;

  const heading = (lede: ReactNode) => (
    <header className="reg-step-head">
      <h2 ref={headingRef} tabIndex={-1} className="reg-step-title">
        {STEP_TITLE[current]}
      </h2>
      {lede === null ? null : <p className="reg-step-lede">{lede}</p>}
    </header>
  );

  /** A small inline "Edit" that returns to the step owning a fact. */
  const edit = (target: Step, what: string) =>
    steps.includes(target) ? (
      <button
        type="button"
        className="reg-edit"
        aria-label={`Edit ${what}`}
        onClick={() => {
          goTo(target);
        }}
      >
        Edit
      </button>
    ) : null;

  return (
    <Card data-testid="register-card" className="reg-card" elevation="floating">
      <RegStepper
        labels={[...(verifiedLead ? ["Verified"] : []), ...steps.map((entry) => STEP_LABEL[entry])]}
        current={stepIndex + (verifiedLead ? 1 : 0)}
      />

      {current === "mobile" ? (
        <section className="reg-step" data-testid="register-step-mobile">
          {heading(
            <span data-testid="registration-needs-phone">
              Organizers text players about their registration and on auction day. Your number is
              never published.
            </span>,
          )}
          <AddPhoneStep
            returnTo={returnTo}
            onVerified={() => {
              moved.current = true;
            }}
          />
        </section>
      ) : null}

      {current === "you" ? (
        <section className="reg-step" data-testid="register-step-profile">
          {heading(null)}
          <SelfPhotoUploader
            slug={slug}
            name={name}
            photoUrl={photoUrl}
            onUploaded={setPhotoUrl}
            variant="hero"
          >
            <p className="reg-photo-why">
              Optional — a photo puts your face on your player card and the auction screen.
            </p>
          </SelfPhotoUploader>
          <form action={saveName} className="register-form">
            <Field
              label="Your name"
              name="name"
              required
              autoFocus
              autoComplete="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="Rohan Kulkarni"
              help="As teammates know you — it's shown on the season's public page."
              {...(error !== null ? { error } : {})}
            />
            <div className="reg-actions">
              <Button type="submit" size="touch" loading={pending}>
                Continue
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {current === "play" ? (
        <section className="reg-step" data-testid="register-step-role">
          {heading(null)}
          <div className="reg-who">
            <PlayerImage
              name={name}
              size="md"
              shape="round"
              {...(photoUrl !== null ? { src: photoUrl } : {})}
            />
            <p className="reg-who-text">
              <strong>{name}</strong>
              {phone === null ? null : <span>{formatPhone(phone)} · verified</span>}
            </p>
          </div>
          <fieldset
            className="reg-choice"
            aria-describedby={roleError !== null ? "reg-role-error" : undefined}
          >
            <legend className="reg-choice-legend">
              Playing role
              <span className="reg-required" aria-hidden>
                {" "}
                *
              </span>
            </legend>
            <div className="reg-choice-options">
              {roles.map((entry, index) => (
                <label key={entry.key} className="reg-chip">
                  <input
                    ref={index === 0 ? firstRoleRef : undefined}
                    type="radio"
                    name="role"
                    value={entry.key}
                    checked={role === entry.key}
                    required
                    onChange={() => {
                      chooseRole(entry.key);
                    }}
                  />
                  <span className="reg-chip-mark" aria-hidden>
                    <IconCheck size={16} />
                  </span>
                  {entry.label}
                </label>
              ))}
            </div>
            {roleError !== null ? (
              <p id="reg-role-error" role="alert" className="register-error">
                {roleError}
              </p>
            ) : null}
          </fieldset>

          <p className="reg-section-label">Optional</p>
          <div className="reg-grid">
            {/* PRR P0-2 (DPDP Act 2023 §9): an under-18 date of birth opens the
                guardian consent below, and a minor's age and photo are never
                published (server/competition/public.ts). An adult's AGE is
                published; the date itself never is. */}
            <Field
              label="Date of birth"
              name="dateOfBirth"
              type="date"
              value={dob}
              onChange={(event) => {
                setDob(event.target.value);
                saveDraft({ dob: event.target.value });
              }}
              help="Only your age is shown — never the date."
            />
            {dobIsMinor ? (
              <div className="reg-guardian" data-testid="guardian-block">
                <p className="reg-guardian-head">Under 18 — a parent or guardian confirms</p>
                <p className="register-hint">
                  A minor&apos;s age and photo are never shown on public pages.
                </p>
                <Field
                  label="Parent or guardian's name"
                  name="guardianName"
                  value={guardianName}
                  onChange={(event) => {
                    setGuardianName(event.target.value);
                    if (event.target.value.trim() !== "") {
                      setGuardianError(null);
                    }
                  }}
                  required
                  ref={guardianRef}
                  data-testid="guardian-name"
                />
                <label className="register-consent-check" htmlFor="guardian-consent-box">
                  <input
                    id="guardian-consent-box"
                    type="checkbox"
                    checked={guardianConsent}
                    data-testid="guardian-consent"
                    onChange={(event) => {
                      setGuardianConsent(event.target.checked);
                      if (event.target.checked) {
                        setGuardianError(null);
                      }
                    }}
                  />
                  <span>{GUARDIAN_CONSENT_LABEL}</span>
                </label>
                {guardianError !== null ? (
                  <p role="alert" className="register-error" data-testid="guardian-error">
                    {guardianError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {attributes.map((attribute) => (
              <Select
                key={attribute.key}
                label={attribute.label}
                name={`attr.${attribute.key}`}
                value={attrs[attribute.key] ?? ""}
                onChange={(event) => {
                  const next = { ...attrs, [attribute.key]: event.target.value };
                  setAttrs(next);
                  saveDraft({ attributes: next });
                }}
              >
                <option value="">Not specified</option>
                {attribute.options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ))}
          </div>

          <p className="reg-saved">Saved on this device as you go.</p>
          <div className="reg-actions">
            {askName ? (
              <Button
                variant="ghost"
                size="touch"
                onClick={() => {
                  goTo("you");
                }}
              >
                Back
              </Button>
            ) : null}
            <Button
              size="touch"
              data-testid="register-continue"
              onClick={() => {
                // Held at the step that collects them, so Confirm never shows a
                // registration the server is going to refuse.
                if (!roles.some((entry) => entry.key === role)) {
                  setRoleError("Choose your playing role to continue.");
                  firstRoleRef.current?.focus();
                  return;
                }
                if (guardianMissing) {
                  setGuardianError(GUARDIAN_REQUIRED);
                  guardianRef.current?.focus();
                  return;
                }
                setError(null);
                setGuardianError(null);
                goTo("confirm");
              }}
            >
              Continue
            </Button>
          </div>
        </section>
      ) : null}

      {current === "confirm" ? (
        <section className="reg-step" data-testid="register-step-review">
          {heading(null)}
          {restored ? (
            <p className="reg-restored" role="status" data-testid="draft-restored">
              We brought back the answers you had already given — check them below.
            </p>
          ) : null}

          <div className="reg-summary">
            <SelfPhotoUploader
              slug={slug}
              name={name}
              photoUrl={photoUrl}
              onUploaded={setPhotoUrl}
              variant="inline"
            >
              <p className="reg-summary-name">
                {name}
                {edit("you", "your name")}
              </p>
              {phone === null ? null : (
                <p className="reg-summary-sub">
                  {formatPhone(phone)} <span className="reg-private">· private</span>
                </p>
              )}
            </SelfPhotoUploader>
            {/* DA-21: every answer "How you play" collects is shown here, so a
                player can check what they are about to submit. Skipped
                optional rows stay omitted rather than printing "Not
                specified" three times. */}
            <dl className="reg-facts">
              <div className="reg-fact">
                <dt>Playing role</dt>
                <dd>
                  <span>{roleLabel}</span>
                  {edit("play", "playing role")}
                </dd>
              </div>
              {dob !== "" ? (
                <div className="reg-fact">
                  <dt>Date of birth</dt>
                  <dd>
                    <span>{formatDate(dob)}</span>
                    {edit("play", "date of birth")}
                  </dd>
                </div>
              ) : null}
              {attributes.map((attribute) => {
                const chosen = attribute.options.find(
                  (option) => option.key === (attrs[attribute.key] ?? ""),
                );
                return chosen === undefined ? null : (
                  <div className="reg-fact" key={attribute.key}>
                    <dt>{attribute.label}</dt>
                    <dd>
                      <span>{chosen.label}</span>
                      {edit("play", attribute.label.toLowerCase())}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>

          {/* What becomes public, said in one sentence where the decision is
              made — and in full one tap away. The split is the point: one line
              for what stays private, one for what does not. */}
          <div className="reg-notice" data-testid="register-privacy">
            <p className="reg-notice-line">
              <IconEye size={18} />
              <span>
                Your name, role, photo and the details above are published on this season&apos;s
                public pages. <strong>Your mobile number never is.</strong>
              </span>
            </p>
            <details className="reg-disclosure">
              <summary>What becomes public</summary>
              <ul>
                <li>
                  Once the organizer publishes the season: your name, registration number, playing
                  role, your age if you gave a date of birth (never the date)
                  {attributes.length === 0
                    ? ""
                    : `, your ${attributes
                        .map((attribute) => attribute.label.toLowerCase())
                        .join(" and ")} if you gave ${attributes.length === 1 ? "it" : "them"}`}
                  , your photo if you add one, and later the team that signs you.
                </li>
                <li>
                  It appears on the season&apos;s public player list and on a player page of your
                  own. Both make a preview card with your name and role when the link is shared.
                  Anyone with the link can read them; search engines are asked not to index player
                  pages.
                </li>
                <li>
                  Your photo shows on the auction board and screen too. For a player under 18,
                  neither age nor photo is ever public.
                </li>
                <li>Your mobile number goes to the organizer of {competitionName} only.</li>
                <li>
                  Withdraw any time from this page — it takes both pages down.{" "}
                  <a href="/help/whats-public" target="_blank" rel="noreferrer">
                    What&apos;s public about you
                  </a>{" "}
                  ·{" "}
                  <a href="/legal/privacy" target="_blank" rel="noreferrer">
                    Privacy policy
                  </a>
                </li>
              </ul>
            </details>
          </div>

          {/* An affirmative act, adjacent to Submit. Submit stays ENABLED and
              refuses out loud: a greyed-out button with no spoken reason is the
              same silence this whole block exists to end. */}
          <div className="reg-checks">
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
            {/* WhatsApp updates, and the language they come in once ticked.
                Unticked; leaving it unticked changes nothing already chosen. */}
            <label
              className="register-consent-check reg-check-quiet"
              htmlFor="register-whatsapp-box"
            >
              <input
                id="register-whatsapp-box"
                type="checkbox"
                checked={whatsapp}
                data-testid="register-whatsapp"
                onChange={(event) => {
                  setWhatsapp(event.target.checked);
                }}
              />
              <span>{WHATSAPP_CONSENT_LABEL}</span>
            </label>
            {whatsapp ? (
              <fieldset className="reg-wa-language" data-testid="register-whatsapp-language">
                <legend className="reg-wa-language-legend">Language for your messages</legend>
                <div className="reg-wa-language-options">
                  {WHATSAPP_LANGUAGES.map((option) => (
                    <label key={option} className="reg-wa-language-option" lang={option}>
                      <input
                        type="radio"
                        name="register-whatsapp-language"
                        value={option}
                        checked={whatsappLanguage === option}
                        data-testid={`register-whatsapp-language-${option}`}
                        onChange={() => {
                          setWhatsappLanguage(option);
                        }}
                      />
                      <span>{WHATSAPP_LANGUAGE_LABELS[option].label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {/* PI-1 write-back. A convenience, not a consent — defaults on. */}
            <label
              className="register-consent-check reg-check-quiet"
              htmlFor="register-remember-box"
            >
              <input
                id="register-remember-box"
                type="checkbox"
                checked={remember}
                data-testid="register-remember"
                onChange={(event) => {
                  setRemember(event.target.checked);
                }}
              />
              <span>Remember these answers for my next registration.</span>
            </label>
          </div>
          {error !== null ? (
            <p role="alert" className="register-error">
              {error}
            </p>
          ) : null}
          <div className="reg-actions">
            <Button
              variant="ghost"
              size="touch"
              onClick={() => {
                goTo("play");
              }}
            >
              Back
            </Button>
            <Button size="touch" loading={pending} data-testid="register-submit" onClick={submit}>
              Submit registration
            </Button>
          </div>
        </section>
      ) : null}
    </Card>
  );
}
