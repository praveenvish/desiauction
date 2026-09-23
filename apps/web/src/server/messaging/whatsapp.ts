import { consentRecords, people, type Db } from "@desiauction/db";
import {
  WHATSAPP_CONSENT_PURPOSE,
  languageFromEvidence as consentLanguage,
  resolveLanguage,
} from "@desiauction/messaging/language";
import { and, desc, eq } from "drizzle-orm";

import { env } from "../../env";
import {
  WHATSAPP_CONSENT_LABEL,
  WHATSAPP_LANGUAGES,
  type WhatsAppLanguage,
} from "../../lib/whatsapp-consent";
import { recordConsent } from "./consent";
import type { SmsTransport } from "./sms";
import type { TemplateKey } from "./templates";
import { isProviderTimeout, providerFetch } from "./provider-fetch";

/**
 * PERSONAL MESSAGES ON WHATSAPP.
 *
 * WhatsApp is where this market lives (docs/47 C-19), and since SMS/DLT was
 * deferred (founder decision, 2026-09-23) it is THE text channel: every moment
 * that has an SMS has a WhatsApp template here, in English and in Hindi, and a
 * person who opted in gets it here — the same moment, one ping, with the player
 * card as the picture on a sale.
 *
 * Three things must be true to send on WhatsApp, all checked when the message
 * goes, never when it is queued:
 *
 *   · the person OPTED IN — an unticked box at registration or the switch on
 *     /account, recorded as a `whatsapp.updates` consent row (Meta requires an
 *     opt-in for a business-initiated message, DPDP requires it be
 *     affirmative). Nobody gets WhatsApp without one, security alerts included;
 *   · the platform has the template — Meta approves each one by NAME, and the
 *     approved name is mapped at /admin/notifications/templates, or else set
 *     in the env var the template declares (provider-templates.ts);
 *   · the Cloud API account is set up (the sign-in sender's credentials).
 *
 * Otherwise the moment goes by SMS where an SMS gateway exists, and where none
 * does the text is suppressed as `no_text_channel` and the email carries it
 * (text-route.ts). Nothing here is a shell that pretends.
 *
 * The template texts below are what gets SUBMITTED to Meta, and the sheet in
 * docs/messaging/WHATSAPP_TEMPLATES.md is generated from them
 * (`pnpm --filter @desiauction/web wa:sheet`).
 */

// One constant, in the package the finops runner reads it from too.
export { WHATSAPP_CONSENT_PURPOSE };

export { WHATSAPP_CONSENT_LABEL, WHATSAPP_LANGUAGES, type WhatsAppLanguage };

/**
 * Every moment a WhatsApp template exists for: each SMS shape, plus the one
 * alert that never had an SMS — the email change, which DLT would have needed
 * its own registration for (auth/email-changed-notice.ts).
 */
export type WhatsAppKey = TemplateKey | "security.email_changed";

/** What fills a variable: the person's own name, or one of the moment's slots. */
export type WhatsAppParam =
  | "name"
  | "team"
  | "price"
  | "competition"
  | "role"
  | "opponent"
  | "when"
  | "reason"
  | "last4"
  | "email";

export interface WhatsAppTemplate {
  readonly key: WhatsAppKey;
  /**
   * Meta's category. Utility: a direct consequence of the person's own entry,
   * or an alert about their own account — never marketing.
   */
  readonly category: "UTILITY";
  /** A picture at the top (the player card) or none. */
  readonly header: "image" | "none";
  /**
   * Submitted text, one per language; `{{n}}` are Meta's positional variables.
   *
   * ONE parameter list serves both: the recipient's language picks the body,
   * and the same values fill it. So the two bodies carry the same variables IN
   * THE SAME ORDER — a Hindi sentence that wanted the season first has been
   * written around it rather than reordered (whatsapp.test.ts holds this).
   */
  readonly body: Readonly<Record<WhatsAppLanguage, string>>;
  /** What fills `{{1}}…{{n}}`, in order. */
  readonly params: readonly WhatsAppParam[];
  /** A sample for each variable, per language — Meta's review asks for them. */
  readonly samples: Readonly<Record<WhatsAppLanguage, readonly string[]>>;
  readonly footer: string;
  /** One static URL button: the link is fixed text, never a variable. */
  readonly button: {
    readonly label: Readonly<Record<WhatsAppLanguage, string>>;
    readonly url: string;
  };
  /**
   * The env var holding the name Meta approved this template under — the
   * FALLBACK since Phase 3: an admin mapping wins (provider-templates.ts). ONE name
   * for both languages: Meta approves a template name with several language
   * versions, and the send picks the version by language code.
   */
  readonly nameEnv: string;
}

const HOME = "https://desiauction.in/home";
const SUPPORT = "https://desiauction.in/support";
const SEE_SEASON = { en: "See your season", hi: "अपना सीज़न देखें" } as const;
const SEE_REGISTRATION = { en: "See your registration", hi: "अपना रजिस्ट्रेशन देखें" } as const;
const GET_HELP = { en: "Get help", hi: "मदद लें" } as const;

/*
 * THE WORDING, and two rules Meta's review enforces that the SMS never had to:
 * a body may not START or END on a variable. "{{1}}, you are in the lineup…"
 * and "…for {{4}}." were both written that way and would have come back
 * rejected, so each now opens on a greeting and closes on fixed words.
 *
 * The Hindi is the Hindi a club WhatsApp group actually uses: everyday words,
 * and the English ones people say anyway (रजिस्ट्रेशन, ऑक्शन, टीम, लाइनअप) left
 * as they are said. Names, teams, seasons and ₹ amounts are variables in both.
 */
export const WHATSAPP_TEMPLATES: Readonly<Record<WhatsAppKey, WhatsAppTemplate>> = {
  "registration.approved": {
    key: "registration.approved",
    category: "UTILITY",
    header: "none",
    body: {
      en: "Hi {{1}}, you are approved for {{2}}. You are in the player pool for auction day.",
      hi: "नमस्ते {{1}}, {{2}} के लिए आपका रजिस्ट्रेशन मंज़ूर हो गया है। ऑक्शन के दिन आप प्लेयर पूल में रहेंगे।",
    },
    params: ["name", "competition"],
    samples: {
      en: ["Arjun", "Malad Premier League 2026"],
      hi: ["Arjun", "Malad Premier League 2026"],
    },
    footer: "DesiAuction",
    button: { label: SEE_REGISTRATION, url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_REGISTRATION_APPROVED",
  },
  "registration.waitlisted": {
    key: "registration.waitlisted",
    category: "UTILITY",
    header: "none",
    body: {
      en: "Hi {{1}}, you are on the waitlist for {{2}}. The organizer moves players up if a place opens.",
      hi: "नमस्ते {{1}}, {{2}} के लिए आप वेटिंग लिस्ट में हैं। जगह खाली होने पर आयोजक खिलाड़ियों को आगे बढ़ाते हैं।",
    },
    params: ["name", "competition"],
    samples: {
      en: ["Arjun", "Malad Premier League 2026"],
      hi: ["Arjun", "Malad Premier League 2026"],
    },
    footer: "DesiAuction",
    button: { label: SEE_REGISTRATION, url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_REGISTRATION_WAITLISTED",
  },
  "registration.rejected": {
    key: "registration.rejected",
    category: "UTILITY",
    header: "none",
    // The reason is a closed set (REASON_TO_PLAYER), translated for a Hindi
    // reader by `whatsappParams` — so it is never English inside a Hindi line.
    body: {
      en: "Hi {{1}}, your registration for {{2}} was not approved. Reason: {{3}}. Tap below for the details.",
      hi: "नमस्ते {{1}}, {{2}} के लिए आपका रजिस्ट्रेशन मंज़ूर नहीं हुआ। कारण: {{3}}। पूरी जानकारी के लिए नीचे टैप करें।",
    },
    params: ["name", "competition", "reason"],
    samples: {
      en: ["Arjun", "Malad Premier League 2026", "the season is full"],
      hi: ["Arjun", "Malad Premier League 2026", "सीज़न की सभी जगहें भर गई हैं"],
    },
    footer: "DesiAuction",
    button: { label: SEE_REGISTRATION, url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_REGISTRATION_REJECTED",
  },
  "registration.withdrawn": {
    key: "registration.withdrawn",
    category: "UTILITY",
    header: "none",
    body: {
      en: "Hi {{1}}, your registration for {{2}} was withdrawn. You can register again while registration is open.",
      hi: "नमस्ते {{1}}, {{2}} के लिए आपका रजिस्ट्रेशन वापस ले लिया गया है। रजिस्ट्रेशन खुला रहने तक आप फिर से रजिस्टर कर सकते हैं।",
    },
    params: ["name", "competition"],
    samples: {
      en: ["Arjun", "Malad Premier League 2026"],
      hi: ["Arjun", "Malad Premier League 2026"],
    },
    footer: "DesiAuction",
    button: { label: SEE_REGISTRATION, url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_REGISTRATION_WITHDRAWN",
  },
  "registration.restored": {
    key: "registration.restored",
    category: "UTILITY",
    header: "none",
    body: {
      en: "Hi {{1}}, your registration for {{2}} is back under review. We will tell you what the organizer decides.",
      hi: "नमस्ते {{1}}, {{2}} के लिए आपका रजिस्ट्रेशन फिर से जाँच में है। आयोजक का फ़ैसला होते ही हम आपको बताएँगे।",
    },
    params: ["name", "competition"],
    samples: {
      en: ["Arjun", "Malad Premier League 2026"],
      hi: ["Arjun", "Malad Premier League 2026"],
    },
    footer: "DesiAuction",
    button: { label: SEE_REGISTRATION, url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_REGISTRATION_RESTORED",
  },
  /*
   * The account alerts. Sent to the account OWNER — the phone change to the
   * number being given up, which is the one a thief does not hold — and only
   * on WhatsApp for somebody who opted in, like everything else here. The
   * email is the other half of each alert (auth/email-changed-notice.ts).
   */
  "security.phone_changed": {
    key: "security.phone_changed",
    category: "UTILITY",
    header: "none",
    body: {
      en: "Hi {{1}}, the mobile number on your DesiAuction account was changed to one ending {{2}}. If this was not you, get help right away.",
      hi: "नमस्ते {{1}}, आपके DesiAuction अकाउंट का मोबाइल नंबर बदलकर {{2}} पर ख़त्म होने वाला नंबर कर दिया गया है। अगर यह आपने नहीं किया, तो तुरंत मदद लें।",
    },
    params: ["name", "last4"],
    samples: { en: ["Arjun", "4321"], hi: ["Arjun", "4321"] },
    footer: "DesiAuction",
    button: { label: GET_HELP, url: SUPPORT },
    nameEnv: "WHATSAPP_TEMPLATE_SECURITY_PHONE_CHANGED",
  },
  "security.email_changed": {
    key: "security.email_changed",
    category: "UTILITY",
    header: "none",
    // `{{2}}` is masked ("a•••@example.com"): a warning must not hand whoever
    // reads it a working contact for the account.
    body: {
      en: "Hi {{1}}, the sign-in email on your DesiAuction account was changed to {{2}}. If this was not you, get help right away.",
      hi: "नमस्ते {{1}}, आपके DesiAuction अकाउंट का साइन-इन ईमेल बदलकर {{2}} कर दिया गया है। अगर यह आपने नहीं किया, तो तुरंत मदद लें।",
    },
    params: ["name", "email"],
    samples: { en: ["Arjun", "a•••@example.com"], hi: ["Arjun", "a•••@example.com"] },
    footer: "DesiAuction",
    button: { label: GET_HELP, url: SUPPORT },
    nameEnv: "WHATSAPP_TEMPLATE_SECURITY_EMAIL_CHANGED",
  },
  "auction.sold": {
    key: "auction.sold",
    category: "UTILITY",
    header: "image",
    body: {
      en: "Congratulations, {{1}}! {{2}} bought you for {{3}} in the {{4}} auction. Your player card is above — share it with your team.",
      hi: "बधाई हो, {{1}}! {{2}} ने आपको {{3}} में खरीदा है — {{4}} के ऑक्शन में। आपका प्लेयर कार्ड ऊपर है — इसे अपनी टीम के साथ शेयर करें।",
    },
    params: ["name", "team", "price", "competition"],
    samples: {
      en: ["Arjun", "Cup Kings", "₹75,000", "Malad Premier League 2026"],
      hi: ["Arjun", "Cup Kings", "₹75,000", "Malad Premier League 2026"],
    },
    footer: "DesiAuction",
    button: { label: SEE_SEASON, url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_AUCTION_SOLD",
  },
  "team.appointed": {
    key: "team.appointed",
    category: "UTILITY",
    header: "none",
    body: {
      en: "Congratulations, {{1}}! You are named {{2}} of {{3}} for {{4}}. Tap below to see your season.",
      hi: "बधाई हो, {{1}}! आपको {{2}} चुना गया है — टीम {{3}}, {{4}}। अपना सीज़न देखने के लिए नीचे टैप करें।",
    },
    params: ["name", "role", "team", "competition"],
    samples: {
      en: ["Vikram", "captain", "Cup Kings", "Malad Premier League 2026"],
      hi: ["Vikram", "captain", "Cup Kings", "Malad Premier League 2026"],
    },
    footer: "DesiAuction",
    button: { label: SEE_SEASON, url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_TEAM_APPOINTED",
  },
  "lineup.announced": {
    key: "lineup.announced",
    category: "UTILITY",
    header: "none",
    body: {
      en: "Hi {{1}}, you are in the {{2}} lineup vs {{3}} on {{4}}. Good luck!",
      hi: "नमस्ते {{1}}, आप {{2}} की लाइनअप में हैं — {{3}} के ख़िलाफ़, {{4}} को। शुभकामनाएँ!",
    },
    params: ["name", "team", "opponent", "when"],
    samples: {
      en: ["Arjun", "Cup Kings", "Tigers", "Sun, 4 Oct, 7:30 pm"],
      hi: ["Arjun", "Cup Kings", "Tigers", "Sun, 4 Oct, 7:30 pm"],
    },
    footer: "DesiAuction",
    button: { label: SEE_SEASON, url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_LINEUP_ANNOUNCED",
  },
};

/**
 * The name to submit each template under when nobody has chosen one — the
 * generated sheet's suggestion and the admin submit dialog's default.
 */
export const WHATSAPP_SUGGESTED_NAMES: Readonly<Record<WhatsAppKey, string>> = {
  "registration.approved": "da_registration_approved",
  "registration.waitlisted": "da_registration_waitlisted",
  "registration.rejected": "da_registration_rejected",
  "registration.withdrawn": "da_registration_withdrawn",
  "registration.restored": "da_registration_restored",
  "security.phone_changed": "da_security_phone_changed",
  "security.email_changed": "da_security_email_changed",
  "auction.sold": "da_auction_sold",
  "team.appointed": "da_team_appointed",
  "lineup.announced": "da_lineup_announced",
};

export function isWhatsAppKey(key: string): key is WhatsAppKey {
  return Object.prototype.hasOwnProperty.call(WHATSAPP_TEMPLATES, key);
}

/**
 * The rejection reasons in Hindi, keyed by the English words the SMS and the
 * registration page use (competition/registration-notify.ts REASON_TO_PLAYER).
 * Keyed by text, not by reason code, because the queued row carries the words:
 * whatsapp.test.ts proves every reason has its Hindi here.
 */
export const REASON_HI: Readonly<Record<string, string>> = {
  "you were already registered": "आप पहले से रजिस्टर्ड थे",
  "eligibility rules were not met": "योग्यता के नियम पूरे नहीं हुए",
  "you asked to withdraw": "आपने नाम वापस लेने को कहा था",
  "the season is full": "सीज़न की सभी जगहें भर गई हैं",
  "no reason was given": "कोई कारण नहीं बताया गया",
};

/**
 * The template's variables, in order. The name is the person's own, read when
 * the message goes; the rest are the moment's slots — with the rupee sign put
 * back, because WhatsApp is not held to GSM-7, and a rejection's reason in the
 * reader's own language.
 */
export function whatsappParams(
  template: WhatsAppTemplate,
  slots: Readonly<Record<string, string>>,
  name: string,
  language: WhatsAppLanguage = "en",
): string[] {
  return template.params.map((param) => {
    if (param === "name") return name;
    const value = slots[param] ?? "";
    if (param === "price") return value.replace(/^Rs\s*/, "₹");
    if (param === "reason" && language === "hi") return REASON_HI[value] ?? value;
    return value;
  });
}

// --- Opt-in --------------------------------------------------------------------

export interface WhatsAppConsent {
  readonly optedIn: boolean;
  /** Which version of each template they get. English until they choose. */
  readonly language: WhatsAppLanguage;
}

/**
 * The language from a person's consent history, newest first: the newest
 * record that NAMES one (packages/messaging language.ts has why), English when
 * none does.
 */
export function languageFromEvidence(
  newestFirst: readonly { readonly evidence: unknown }[],
): WhatsAppLanguage {
  return consentLanguage(newestFirst) ?? "en";
}

/**
 * The latest answer wins: consent_records is append-only. Twenty rows is far
 * more history than anybody makes, and bounds the read for somebody who
 * toggles the switch for fun.
 *
 * THE LANGUAGE is the person's ONE language (Notification Control Center,
 * Phase 2): `people.language` when they chose one — under "Language for
 * messages", which drives their email too — and only then the language named
 * with the opt-in, then English. The Hindi→English fallback when Meta has not
 * approved a Hindi version yet (132001) stays where it was, in the send.
 */
export async function whatsappOptedIn(db: Db, personId: string): Promise<WhatsAppConsent> {
  const [history, [person]] = await Promise.all([
    db
      .select({ granted: consentRecords.granted, evidence: consentRecords.evidence })
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.personId, personId),
          eq(consentRecords.purpose, WHATSAPP_CONSENT_PURPOSE),
        ),
      )
      .orderBy(desc(consentRecords.createdAt))
      .limit(20),
    db.select({ language: people.language }).from(people).where(eq(people.id, personId)).limit(1),
  ]);
  return {
    optedIn: history[0]?.granted === true,
    language: resolveLanguage(person?.language, consentLanguage(history)),
  };
}

export async function setWhatsappOptIn(
  db: Db,
  input: {
    personId: string;
    granted: boolean;
    source: "registration" | "account";
    competition?: string;
    /** Chosen with the opt-in; a change of language is a new record too. */
    language?: WhatsAppLanguage;
  },
): Promise<void> {
  await recordConsent(db, {
    personId: input.personId,
    purpose: WHATSAPP_CONSENT_PURPOSE,
    granted: input.granted,
    source: input.source,
    evidence: {
      wording: WHATSAPP_CONSENT_LABEL,
      ...(input.competition === undefined ? {} : { competition: input.competition }),
      ...(input.language === undefined ? {} : { language: input.language }),
    },
  });
}

// --- The sender ----------------------------------------------------------------

export interface WhatsAppMessage {
  /** The approved template name. */
  readonly name: string;
  readonly template: WhatsAppTemplate;
  readonly params: readonly string[];
  /** The header picture, for a template that has one. */
  readonly imageUrl: string | null;
  /** Which approved version: Meta's language code, "en" or "hi". */
  readonly language: WhatsAppLanguage;
}

/** What Meta answered a send with. */
export interface WhatsAppReceipt {
  /**
   * The `wamid…` Meta gave the message — the key its delivery callbacks name
   * (/api/webhooks/whatsapp). Null when a success came back without one: the
   * message went, and only its tracking is lost, so that is not a failure.
   */
  readonly messageId: string | null;
}

export interface PersonalWhatsAppSender {
  send(phone: string, message: WhatsAppMessage): Promise<WhatsAppReceipt>;
}

/**
 * Why a send did not go, which decides what the drain does next (text-route.ts):
 *
 *   · `refused` — Meta answered no (a 4xx, or its 200-with-an-error). Trying
 *     the same message again gets the same answer.
 *   · `unavailable` — Meta was unreachable or answered 5xx/429. Nothing was
 *     accepted, and a later try may well go.
 *   · `breaker` — our own breaker turned it away without calling Meta.
 *   · `timeout` — the call died on OUR deadline. Meta may have accepted it.
 */
export type WhatsAppFailure = "refused" | "unavailable" | "breaker" | "timeout";

export class WhatsAppSendError extends Error {
  readonly failure: WhatsAppFailure;

  constructor(
    message: string,
    /**
     * Meta may have ACCEPTED it: the call died on our deadline, not on a
     * refusal. The drain must not cover this with an SMS, or retry it
     * (outbox.ts) — that would be the same moment twice.
     */
    readonly outcomeUnknown = false,
    failure?: WhatsAppFailure,
    /** Meta's own error code on a refusal (`error.code`), when it gave one. */
    readonly metaCode: number | null = null,
  ) {
    super(message);
    this.name = "WhatsAppSendError";
    this.failure = failure ?? (outcomeUnknown ? "timeout" : "refused");
  }
}

/**
 * Meta's "template name does not exist in the translation" — the template is
 * approved, but not (yet) in the language asked for. Hindi approvals trail the
 * English ones, so this is the refusal a Hindi reader meets in the gap, and the
 * one the drain answers by sending the English version instead (outbox.ts).
 */
export const META_MISSING_TRANSLATION = 132001;

/** `{"error":{"code":132001,…}}` → 132001; anything else → null. */
export function parseMetaErrorCode(body: string): number | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return null;
    const error = (parsed as { error?: unknown }).error;
    if (typeof error !== "object" || error === null) return null;
    const code = (error as { code?: unknown }).code;
    return typeof code === "number" && Number.isInteger(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * The message id out of Meta's success body — `{"messages":[{"id":"wamid…"}]}`.
 * Defensive by construction: this runs AFTER Meta accepted the message, so an
 * unexpected body must cost the tracking, never throw into a retry.
 */
export function parseMessageId(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return null;
    const messages = (parsed as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) return null;
    const first: unknown = messages[0];
    if (typeof first !== "object" || first === null) return null;
    const id = (first as { id?: unknown }).id;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

/** Pinned like the OTP sender's: a vendor's "latest" must not move this path. */
const WHATSAPP_API_BASE = "https://graph.facebook.com/v21.0";

// Deadline-bound (provider-fetch.ts): a stalled provider must not outlive the
// outbox's claim lease, or two drains deliver the same message.
const defaultTransport: SmsTransport = providerFetch;

/**
 * Meta Cloud API, utility templates. Same breaker contract as every sender in
 * this product: three consecutive failures open it for a minute, the next send
 * after that is the probe — and while it is open the drain falls back to SMS
 * where there is one, or waits the cooldown out where there is not.
 */
export class WhatsAppCloudSender implements PersonalWhatsAppSender {
  private readonly transport: SmsTransport;
  private readonly now: () => number;
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly config: {
      phoneNumberId: string;
      accessToken: string;
      apiBase?: string;
      transport?: SmsTransport;
      now?: () => number;
    },
  ) {
    this.transport = config.transport ?? defaultTransport;
    this.now = config.now ?? (() => Date.now());
  }

  private breakerOpen(): boolean {
    return this.openedAt !== null && this.now() - this.openedAt < 60_000;
  }

  async send(phone: string, message: WhatsAppMessage): Promise<WhatsAppReceipt> {
    if (this.breakerOpen()) {
      throw new WhatsAppSendError("WhatsApp provider unavailable (breaker open)", false, "breaker");
    }
    const components: unknown[] = [];
    if (message.template.header === "image" && message.imageUrl !== null) {
      components.push({
        type: "header",
        parameters: [{ type: "image", image: { link: message.imageUrl } }],
      });
    }
    components.push({
      type: "body",
      parameters: message.params.map((text) => ({ type: "text", text })),
    });
    const base = this.config.apiBase ?? WHATSAPP_API_BASE;
    let failed: { reason: string; failure: WhatsAppFailure } | null = null;
    let body = "";
    try {
      const response = await this.transport(
        `${base}/${encodeURIComponent(this.config.phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            // Stored E.164 (+91…); Meta wants the digits.
            to: phone.replace(/^\+/, ""),
            type: "template",
            template: {
              name: message.name,
              // Per recipient: the version of the template they chose. Meta
              // holds both under the one approved name.
              language: { code: message.language },
              components,
            },
          }),
        },
      );
      body = response.body;
      const status = String(response.status);
      if (response.status >= 500 || response.status === 429) {
        failed = { reason: `WhatsApp unavailable (status ${status})`, failure: "unavailable" };
      } else if (response.status >= 400 || response.body.includes('"error"')) {
        // Meta answers some refusals 200-with-an-error (the OTP sender's note).
        failed = { reason: `WhatsApp refused the send (status ${status})`, failure: "refused" };
      }
    } catch (error) {
      failed = isProviderTimeout(error)
        ? { reason: "WhatsApp did not answer in time", failure: "timeout" }
        : { reason: "WhatsApp unreachable", failure: "unavailable" };
    }
    if (failed !== null) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= 3) {
        this.openedAt = this.now();
      }
      throw new WhatsAppSendError(
        failed.reason,
        failed.failure === "timeout",
        failed.failure,
        failed.failure === "refused" ? parseMetaErrorCode(body) : null,
      );
    }
    this.consecutiveFailures = 0;
    this.openedAt = null;
    return { messageId: parseMessageId(body) };
  }
}

/**
 * The platform's WhatsApp sender, or null when the account is not set up —
 * the same credentials the WhatsApp OTP path uses.
 *
 * `WHATSAPP_TEMPLATE_LANGUAGE` is deliberately NOT passed any more. It is the
 * sign-in template's locale (Meta words that one, and it may be "en_US"); these
 * templates are submitted as "en" and "hi" (the generated sheet says so) and
 * the language is chosen per recipient.
 */
export function createWhatsAppSender(): PersonalWhatsAppSender | null {
  if (env.WHATSAPP_PHONE_NUMBER_ID === undefined || env.WHATSAPP_ACCESS_TOKEN === undefined) {
    return null;
  }
  return new WhatsAppCloudSender({
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
  });
}
