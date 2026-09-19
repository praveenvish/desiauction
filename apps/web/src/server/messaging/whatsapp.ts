import { consentRecords, type Db } from "@desiauction/db";
import { and, desc, eq } from "drizzle-orm";

import { env } from "../../env";
import { WHATSAPP_CONSENT_LABEL } from "../../lib/whatsapp-consent";
import type { HttpResponse, SmsTransport } from "../competition/registration-notify";
import { recordConsent } from "./consent";
import type { TemplateKey } from "./templates";

/**
 * PERSONAL MESSAGES ON WHATSAPP (Phase 3).
 *
 * WhatsApp is where this market lives (docs/47 C-19), so a player who opts in
 * gets the short message THERE instead of by SMS — the same moment, one ping,
 * with the player card as the picture on a sale. Everyone else keeps the SMS.
 *
 * Two things must be true to send on WhatsApp, both checked when the message
 * goes, never when it is queued:
 *
 *   · the person OPTED IN — an unticked box at registration or the switch on
 *     /account, recorded as a `whatsapp.updates` consent row (Meta requires an
 *     opt-in, DPDP requires it be affirmative);
 *   · the platform has the template — Meta approves each one by NAME, and the
 *     approved name is set in the env var the template declares. Unset, the
 *     message goes by SMS as before: nothing here is a shell that pretends.
 *
 * The template texts below are what gets SUBMITTED to Meta, and the sheet in
 * docs/messaging/WHATSAPP_TEMPLATES.md is generated from them
 * (`pnpm --filter @desiauction/web wa:sheet`).
 */

export const WHATSAPP_CONSENT_PURPOSE = "whatsapp.updates";

export { WHATSAPP_CONSENT_LABEL };

export interface WhatsAppTemplate {
  /** The SMS template this one replaces for an opted-in player. */
  readonly key: TemplateKey;
  /** Meta's category. Utility: a direct consequence of the player's own entry. */
  readonly category: "UTILITY";
  /** A picture at the top (the player card) or none. */
  readonly header: "image" | "none";
  /** Submitted text; `{{n}}` are Meta's positional variables. */
  readonly body: string;
  /** What fills `{{1}}…{{n}}`, in order: the person's name or an SMS slot. */
  readonly params: readonly (
    "name" | "team" | "price" | "competition" | "role" | "opponent" | "when"
  )[];
  /** A sample for each variable — Meta's review asks for one. */
  readonly samples: readonly string[];
  readonly footer: string;
  /** One static URL button: the link is fixed text, never a variable. */
  readonly button: { readonly label: string; readonly url: string };
  /** The env var holding the name Meta approved this template under. */
  readonly nameEnv: string;
}

const HOME = "https://desiauction.in/home";

export const WHATSAPP_TEMPLATES: Readonly<Partial<Record<TemplateKey, WhatsAppTemplate>>> = {
  "auction.sold": {
    key: "auction.sold",
    category: "UTILITY",
    header: "image",
    body: "Congratulations, {{1}}! {{2}} bought you for {{3}} in the {{4}} auction. Your player card is above — share it with your team.",
    params: ["name", "team", "price", "competition"],
    samples: ["Arjun", "Cup Kings", "₹75,000", "Malad Premier League 2026"],
    footer: "DesiAuction",
    button: { label: "See your season", url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_AUCTION_SOLD",
  },
  "team.appointed": {
    key: "team.appointed",
    category: "UTILITY",
    header: "none",
    body: "Congratulations, {{1}}! You are named {{2}} of {{3}} for {{4}}.",
    params: ["name", "role", "team", "competition"],
    samples: ["Vikram", "captain", "Cup Kings", "Malad Premier League 2026"],
    footer: "DesiAuction",
    button: { label: "See your season", url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_TEAM_APPOINTED",
  },
  "lineup.announced": {
    key: "lineup.announced",
    category: "UTILITY",
    header: "none",
    body: "{{1}}, you are in the {{2}} lineup vs {{3}} on {{4}}. Good luck!",
    params: ["name", "team", "opponent", "when"],
    samples: ["Arjun", "Cup Kings", "Tigers", "Sun, 4 Oct, 7:30 pm"],
    footer: "DesiAuction",
    button: { label: "See your season", url: HOME },
    nameEnv: "WHATSAPP_TEMPLATE_LINEUP_ANNOUNCED",
  },
};

/** The name Meta approved this template under, when it is configured. */
export function whatsappTemplateName(key: string): string | undefined {
  const template = WHATSAPP_TEMPLATES[key as TemplateKey];
  if (template === undefined) return undefined;
  const value: unknown = (env as Readonly<Record<string, unknown>>)[template.nameEnv];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The template's variables, in order. The name is the person's own, read when
 * the message goes; the rest are the SMS slots — with the rupee sign put back,
 * because WhatsApp is not held to GSM-7.
 */
export function whatsappParams(
  template: WhatsAppTemplate,
  slots: Readonly<Record<string, string>>,
  name: string,
): string[] {
  return template.params.map((param) => {
    if (param === "name") return name;
    const value = slots[param] ?? "";
    return param === "price" ? value.replace(/^Rs\s*/, "₹") : value;
  });
}

// --- Opt-in --------------------------------------------------------------------

/** The latest answer wins: consent_records is append-only. */
export async function whatsappOptedIn(db: Db, personId: string): Promise<boolean> {
  const [latest] = await db
    .select({ granted: consentRecords.granted })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.personId, personId),
        eq(consentRecords.purpose, WHATSAPP_CONSENT_PURPOSE),
      ),
    )
    .orderBy(desc(consentRecords.createdAt))
    .limit(1);
  return latest?.granted === true;
}

export async function setWhatsappOptIn(
  db: Db,
  input: {
    personId: string;
    granted: boolean;
    source: "registration" | "account";
    competition?: string;
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
}

export interface PersonalWhatsAppSender {
  send(phone: string, message: WhatsAppMessage): Promise<void>;
}

export class WhatsAppSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

/** Pinned like the OTP sender's: a vendor's "latest" must not move this path. */
const WHATSAPP_API_BASE = "https://graph.facebook.com/v21.0";

const defaultTransport: SmsTransport = async (url, init): Promise<HttpResponse> => {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.text() };
};

/**
 * Meta Cloud API, utility templates. Same breaker contract as every sender in
 * this product: three consecutive failures open it for a minute, the next send
 * after that is the probe — and while it is open the drain falls back to SMS.
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
      language?: string;
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

  async send(phone: string, message: WhatsAppMessage): Promise<void> {
    if (this.breakerOpen()) {
      throw new WhatsAppSendError("WhatsApp provider unavailable (breaker open)");
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
    let failed: string | null = null;
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
              language: { code: this.config.language ?? "en" },
              components,
            },
          }),
        },
      );
      // Meta answers some refusals 200-with-an-error (the OTP sender's note).
      if (response.status >= 400 || response.body.includes('"error"')) {
        failed = `WhatsApp refused the send (status ${String(response.status)})`;
      }
    } catch {
      failed = "WhatsApp unreachable";
    }
    if (failed !== null) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= 3) {
        this.openedAt = this.now();
      }
      throw new WhatsAppSendError(failed);
    }
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }
}

/**
 * The platform's WhatsApp sender, or null when the account is not set up —
 * the same credentials the WhatsApp OTP path uses. Null means SMS, always.
 */
export function createWhatsAppSender(): PersonalWhatsAppSender | null {
  if (env.WHATSAPP_PHONE_NUMBER_ID === undefined || env.WHATSAPP_ACCESS_TOKEN === undefined) {
    return null;
  }
  return new WhatsAppCloudSender({
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    ...(env.WHATSAPP_TEMPLATE_LANGUAGE === undefined
      ? {}
      : { language: env.WHATSAPP_TEMPLATE_LANGUAGE }),
  });
}
